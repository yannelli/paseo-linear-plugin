import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useMutation } from "@tanstack/react-query";
import {
  attachIssueCardRpc,
  type IssueDetail,
  type IssuePatch,
  updateIssueRpc,
  type WorkflowState,
} from "../shared/linear";
import { AGENT_LABELS, agentTitle } from "../shared/prompts";
import type { AgentAction, Isolation, LinearSettings } from "../shared/settings";
import type { PaseoProjectOption, ProviderOption } from "./queries";
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

export interface ModelOption {
  value: string;
  label: string;
  detail: string;
  isDefault: boolean;
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

// Reviews look at existing work: the pull request, then the implementing agent's workspace.
function preferredPlacement(action: AgentAction, isolation: Isolation): Placement[] {
  if (action === "review") return ["pull-request", "agent-workspace", "workspace"];
  return isolation === "worktree" ? ["worktree", "workspace"] : ["workspace"];
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

export function modelOptions(providers: readonly ProviderOption[] | undefined): ModelOption[] {
  return (providers ?? []).flatMap((provider) =>
    provider.models.map((model) => ({
      value: `${provider.provider}/${model.id}`,
      label: model.label,
      detail: provider.label,
      isDefault: model.isDefault,
    })),
  );
}

export function resolveModel(
  options: readonly ModelOption[],
  choice: string | null,
  configured: string,
): ModelOption | null {
  const find = (value: string | null) => options.find((option) => option.value === value);
  return (
    find(choice) ??
    find(configured) ??
    options.find((option) => option.isDefault) ??
    options[0] ??
    null
  );
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
  model: string;
  placement: Placement;
  prNumber: number | null;
  target: TargetWorkspace | null;
  agentWorkspace: TargetWorkspace | null;
  prompt: string;
  patch: IssuePatch;
  started: WorkflowState | null;
  /** The Paseo project whose Linear key loaded the issue. */
  keyScope: string | null;
}

type Paseo = ReturnType<typeof usePaseo>;

async function openWorkspace(paseo: Paseo, request: LaunchRequest) {
  const { issue, project } = request;
  if (request.placement === "worktree") {
    return paseo.workspaces.create({
      title: `${issue.identifier} ${issue.title}`,
      source: {
        kind: "worktree",
        cwd: project.rootPath,
        projectId: project.projectId,
        action: "branch-off",
        branchName: issue.branchName,
      },
    });
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
    return paseo.workspaces.create({
      title: `Review ${issue.identifier}`,
      source: {
        kind: "worktree",
        cwd: project.rootPath,
        projectId: project.projectId,
        action: "checkout",
        refName: issue.branchName,
      },
    });
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
  return useMutation({
    mutationFn: async (request: LaunchRequest) => {
      const { issue, action } = request;
      const workspace = await openWorkspace(paseo, request);
      const agent = await workspace.agents.create({
        config: { provider: request.model },
        title: agentTitle(action, issue),
        prompt: request.prompt,
        labels: { [AGENT_LABELS.issue]: issue.identifier, [AGENT_LABELS.action]: action },
      });
      lastProjectByTeam.set(issue.team.id, request.project.projectId);
      let warning: string | null = null;
      if (Object.keys(request.patch).length > 0) {
        try {
          await updateIssue({ id: issue.id, patch: request.patch, projectId: request.keyScope });
        } catch (error) {
          warning = errorMessage(error);
        }
      }
      const state = request.patch.stateId && request.started ? request.started : issue.state;
      const card = {
        identifier: issue.identifier,
        title: issue.title,
        url: issue.url,
        stateName: state.name,
        stateColor: state.color,
        action,
      };
      void attachCard({ agentId: agent.id, card }).catch(() => undefined);
      return { agentId: agent.id, warning };
    },
  });
}
