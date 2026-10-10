import type { RpcOutput } from "@getpaseo/plugin";
import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useMutation } from "@tanstack/react-query";
import {
  attachIssueCardRpc,
  type IssueDetail,
  type IssuePatch,
  updateIssueRpc,
  type WorkflowState,
} from "../shared/linear";
import { agentHooksRpc } from "../shared/agent-hooks";
import { type Assignment, agentToolsRpc, TOOLS_SERVER } from "../shared/agent-tools";
import { AGENT_LABELS, agentTitle } from "../shared/prompts";
import type { AgentAction, Guidance, Isolation, LinearSettings, ToolSettings } from "../shared/settings";
import { type AgentSelection, agentConfig, optionLabel } from "./agent-options";
import { rememberLaunch } from "./agent-preferences";
import type { PaseoProjectOption } from "./queries";
import { errorMessage } from "./ui";

export type Placement = "worktree" | "pull-request" | "branch" | "agent-workspace" | "workspace";

export interface PlacementOption {
  value: Placement;
  label: string;
  detail: string;
}

export interface TargetWorkspace {
  id: string;
  projectId: string;
  name: string;
}

const lastProjectByTeam = new Map<string, string>();

export function pullRequestNumber(issue: IssueDetail): number | null {
  for (const attachment of issue.attachments) {
    const match = /github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/.exec(attachment.url);
    if (match?.[1]) return Number(match[1]);
  }
  return null;
}

export function defaultProjectId(input: {
  target: TargetWorkspace | null;
  teamId: string;
  settings: LinearSettings;
  projects: readonly PaseoProjectOption[] | undefined;
}): string | null {
  if (input.target) return input.target.projectId;
  const remembered = lastProjectByTeam.get(input.teamId);
  if (remembered) return remembered;
  const mapped = input.settings.projects.find((entry) => entry.teamIds.includes(input.teamId));
  return mapped?.projectId ?? input.projects?.[0]?.projectId ?? null;
}

export function placementOptions(input: {
  action: AgentAction;
  prNumber: number | null;
  project: PaseoProjectOption | null;
  branchName: string;
  target: TargetWorkspace | null;
  agentWorkspace: TargetWorkspace | null;
}): PlacementOption[] {
  const options: PlacementOption[] = [];
  const git = input.project?.kind === "git";
  const review = input.action === "review";
  if (review && git && input.prNumber !== null) {
    options.push({
      value: "pull-request",
      label: `Check out PR #${input.prNumber}`,
      detail: "New worktree on the pull request branch",
    });
  }
  if (input.agentWorkspace) {
    options.push({
      value: "agent-workspace",
      label: review ? "Implementation workspace" : "Existing agent workspace",
      detail: input.agentWorkspace.name,
    });
  }
  if (git) {
    options.push(
      review
        ? { value: "branch", label: "Check out issue branch", detail: input.branchName }
        : { value: "worktree", label: "New worktree", detail: input.branchName },
    );
  }
  const here = input.target !== null && input.target.projectId === input.project?.projectId;
  options.push(
    here && input.target
      ? { value: "workspace", label: "This workspace", detail: input.target.name }
      : { value: "workspace", label: "Project folder", detail: input.project?.rootPath ?? "" },
  );
  return options;
}

// Reviews look at existing work: the pull request, the implementing agent's workspace, then
// the issue branch. Checking out a branch nobody pushed yet starts a new worktree instead.
function preferredPlacement(action: AgentAction, isolation: Isolation): Placement[] {
  const review = action === "review";
  const existing: Placement[] = review ? ["pull-request", "agent-workspace"] : [];
  const fresh: Placement[] = isolation === "worktree" ? [review ? "branch" : "worktree"] : [];
  return [...existing, ...fresh, "workspace"];
}

export function resolvePlacement(
  options: readonly PlacementOption[],
  choice: Placement | null,
  action: AgentAction,
  isolation: Isolation,
): PlacementOption | null {
  const wanted = choice ? [choice] : preferredPlacement(action, isolation);
  for (const value of wanted) {
    const match = options.find((option) => option.value === value);
    if (match) return match;
  }
  return options[0] ?? null;
}

export function linearPatch(input: {
  started: WorkflowState | null;
  moveToStarted: boolean;
  viewerId: string | null;
  assignToMe: boolean;
}): IssuePatch {
  const patch: IssuePatch = {};
  if (input.moveToStarted && input.started) patch.stateId = input.started.id;
  if (input.assignToMe && input.viewerId) patch.assigneeId = input.viewerId;
  return patch;
}

export interface LaunchRequest {
  action: AgentAction;
  issue: IssueDetail;
  project: PaseoProjectOption;
  agent: AgentSelection;
  placement: Placement;
  prNumber: number | null;
  target: TargetWorkspace | null;
  agentWorkspace: TargetWorkspace | null;
  prompt: string;
  patch: IssuePatch;
  started: WorkflowState | null;
  /** The Paseo project whose Linear key loaded the issue. */
  keyScope: string | null;
  /** Guidance options; for Claude some also add hooks. */
  guidance: Guidance;
  /** The tool settings of the project. */
  tools: ToolSettings;
  /** Agents the user chose for sub-issues. */
  assignments: readonly SubIssueAgent[];
}

/** The agent the user chose for one sub-issue on the launch page. */
export interface SubIssueAgent {
  identifier: string;
  agent: AgentSelection;
}

/** The agent's name in prompts and replies, such as "Codex · GPT-5.5 · High". */
export function agentLabel(selection: AgentSelection): string {
  const parts = [selection.agent.label, selection.model.label];
  if (selection.effort) parts.push(optionLabel(selection.effort));
  return parts.join(" · ");
}

/** The assignments as the MCP server keeps them, by issue key. */
export function assignmentRecord(assignments: readonly SubIssueAgent[]): Record<string, Assignment> {
  return Object.fromEntries(
    assignments.map((entry) => [entry.identifier, { config: agentConfig(entry.agent), label: agentLabel(entry.agent) }]),
  );
}

type AgentTools = RpcOutput<typeof agentToolsRpc>;

/** The config with the plugin's MCP server, whose token only reaches this issue tree. */
export function withLinearTools<C extends object>(config: C, tools: Pick<AgentTools, "server" | "toolPolicy"> | null) {
  if (!tools) return config;
  return { ...config, mcpServers: { [TOOLS_SERVER]: tools.server }, toolPolicy: tools.toolPolicy };
}

/** The launch needs the MCP tools for Linear edits or agents on sub-issues, when they are on. */
export const needsLinearTools = (guidance: Guidance, tools: ToolSettings, assignments: number) =>
  tools.enabled && (guidance.updateLinear || guidance.paseoSubagents || assignments > 0);

/** The config with the issue's Claude Code hooks, loaded as a plugin with --plugin-dir. */
export function withHookPlugin<C extends object>(config: C, pluginDir: string | null) {
  if (!pluginDir) return config;
  return { ...config, providerOptions: { extraArgs: { "plugin-dir": pluginDir } } };
}

export type Paseo = ReturnType<typeof usePaseo>;

// Linear suggests a branch name for every issue, even when nobody has pushed that branch.
// The plugin API passes only the daemon's message, so match its "Unknown branch" text.
function isUnknownBranch(error: unknown): boolean {
  return errorMessage(error).includes("Unknown branch");
}

function createIssueWorktree(paseo: Paseo, request: LaunchRequest, title: string) {
  const { issue, project } = request;
  return paseo.workspaces.create({
    title,
    source: {
      kind: "worktree",
      cwd: project.rootPath,
      projectId: project.projectId,
      action: "branch-off",
      branchName: issue.branchName,
    },
  });
}

export async function openWorkspace(paseo: Paseo, request: LaunchRequest) {
  const { issue, project } = request;
  if (request.placement === "worktree") {
    return createIssueWorktree(paseo, request, `${issue.identifier} ${issue.title}`);
  }
  if (request.placement === "pull-request" && request.prNumber !== null) {
    return paseo.workspaces.create({
      title: `Review ${issue.identifier}`,
      source: {
        kind: "worktree",
        cwd: project.rootPath,
        projectId: project.projectId,
        action: "checkout",
        checkoutSource: { kind: "change_request", forge: "github", number: request.prNumber },
      },
    });
  }
  if (request.placement === "branch") {
    const title = `Review ${issue.identifier}`;
    try {
      return await paseo.workspaces.create({
        title,
        source: {
          kind: "worktree",
          cwd: project.rootPath,
          projectId: project.projectId,
          action: "checkout",
          refName: issue.branchName,
        },
      });
    } catch (error) {
      if (!isUnknownBranch(error)) throw error;
      return createIssueWorktree(paseo, request, title);
    }
  }
  if (request.placement === "agent-workspace" && request.agentWorkspace) {
    return paseo.workspaces.ref(request.agentWorkspace.id);
  }
  if (request.target && request.target.projectId === project.projectId) {
    return paseo.workspaces.ref(request.target.id);
  }
  return paseo.workspaces.open(project.rootPath);
}

export function useLaunchAgent() {
  const paseo = usePaseo();
  const updateIssue = useRpc(updateIssueRpc);
  const attachCard = useRpc(attachIssueCardRpc);
  const prepareHooks = useRpc(agentHooksRpc);
  const prepareTools = useRpc(agentToolsRpc);
  return useMutation({
    mutationFn: async (request: LaunchRequest) => {
      const { issue, action } = request;
      const workspace = await openWorkspace(paseo, request);
      const state = request.patch.stateId && request.started ? request.started : issue.state;
      const card = {
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        stateName: state.name,
        stateColor: state.color,
        action,
      };
      // Hooks are a Claude Code feature; a failure to write them never blocks the launch.
      const hooks =
        request.agent.agent.id === "claude"
          ? await prepareHooks({
              issue: {
                identifier: issue.identifier,
                title: issue.title,
                children: issue.children.map(({ identifier, title }) => ({ identifier, title })),
              },
              guidance: request.guidance,
            }).catch(() => null)
          : null;
      const config = agentConfig(request.agent);
      // Without the tools the agent still starts; its prompt then names tools it does not have.
      const tools = needsLinearTools(request.guidance, request.tools, request.assignments.length)
        ? await prepareTools({
            root: issue.identifier,
            home: issue.identifier,
            keyScope: request.keyScope,
            workspaceId: workspace.id,
            projectId: request.project.projectId,
            config,
            ...(request.assignments.length > 0 ? { assignments: assignmentRecord(request.assignments) } : {}),
          }).catch(() => null)
        : null;
      const agent = {
        config: withLinearTools(withHookPlugin(config, hooks?.pluginDir ?? null), tools),
        title: agentTitle(action, issue),
        prompt: request.prompt,
        labels: {
          [AGENT_LABELS.issue]: issue.identifier,
          [AGENT_LABELS.action]: action,
          ...(request.keyScope ? { [AGENT_LABELS.project]: request.keyScope } : {}),
          ...(tools ? { [AGENT_LABELS.tools]: tools.grantId } : {}),
        },
      };
      const agentId = (await workspace.agents.create(agent)).id;
      void attachCard({ agentId, card }).catch(() => undefined);
      lastProjectByTeam.set(issue.team.id, request.project.projectId);
      rememberLaunch({
        agent: request.agent.agent.id,
        model: request.agent.model.id,
        effort: request.agent.effort?.id ?? null,
        mode: request.agent.mode?.id ?? null,
      });
      let warning: string | null = null;
      if (Object.keys(request.patch).length > 0) {
        try {
          await updateIssue({ id: issue.id, patch: request.patch, projectId: request.keyScope });
        } catch (error) {
          warning = errorMessage(error);
        }
      }
      return { agentId, warning };
    },
  });
}
