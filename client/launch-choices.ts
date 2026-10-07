import { useWorkspace } from "@getpaseo/plugin/client";
import { useCallback, useMemo, useState } from "react";
import type { IssueDetail } from "../shared/linear";
import type { AgentAction, LinearSettings } from "../shared/settings";
import { type AgentPicks, resolveAgent } from "./agent-options";
import {
  defaultProjectId,
  type Placement,
  placementOptions,
  pullRequestNumber,
  resolvePlacement,
  type TargetWorkspace,
} from "./launch-plan";
import { useLinkedAgents, useProjects, useProviders } from "./queries";

const selectTarget = (workspace: { id: string; projectId: string; name: string }) => ({
  id: workspace.id,
  projectId: workspace.projectId,
  name: workspace.name,
});

const NO_PICKS: AgentPicks = { agent: null, model: null, effort: null, mode: null };

export function useLaunchChoices(input: {
  issue: IssueDetail;
  action: AgentAction;
  settings: LinearSettings;
  workspaceId: string | null;
}) {
  const { issue, settings, action } = input;
  const projects = useProjects();
  const providers = useProviders();
  const target = useWorkspace(input.workspaceId ?? "", selectTarget) as TargetWorkspace | null;
  const prNumber = action === "review" ? pullRequestNumber(issue) : null;
  const linked = useLinkedAgents(issue.identifier);
  const agentWorkspaceId =
    linked.data?.find((agent) => agent.action === "implement" && agent.workspaceId)?.workspaceId ??
    null;
  const agentWorkspace = useWorkspace(
    agentWorkspaceId ?? "",
    selectTarget,
  ) as TargetWorkspace | null;
  const [projectChoice, setProjectChoice] = useState<string | null>(null);
  const [placementChoice, setPlacementChoice] = useState<Placement | null>(null);
  const [picks, setPicks] = useState<AgentPicks>(NO_PICKS);
  const projectId =
    projectChoice ??
    defaultProjectId({ target, teamId: issue.team.id, settings, projects: projects.data });
  const project = projects.data?.find((entry) => entry.projectId === projectId) ?? null;
  const placements = useMemo(
    () =>
      placementOptions({
        action,
        prNumber,
        project,
        branchName: issue.branchName,
        target,
        agentWorkspace,
      }),
    [action, prNumber, project, issue.branchName, target, agentWorkspace],
  );
  const placement = resolvePlacement(
    placements,
    placementChoice,
    action,
    settings.launch.isolation,
  );
  const agents = providers.data ?? [];
  const agent = resolveAgent(agents, picks, settings.launch.provider);
  const chooseProject = useCallback((value: string) => {
    setProjectChoice(value);
    setPlacementChoice(null);
  }, []);
  const choosePlacement = useCallback(
    (value: string) => setPlacementChoice(value as Placement),
    [],
  );
  // A new agent starts from its own default model, effort, and mode.
  const chooseAgent = useCallback((value: string) => setPicks({ ...NO_PICKS, agent: value }), []);
  const chooseModel = useCallback(
    (value: string) => setPicks((current) => ({ ...current, model: value, effort: null })),
    [],
  );
  const chooseEffort = useCallback(
    (value: string) => setPicks((current) => ({ ...current, effort: value })),
    [],
  );
  const chooseMode = useCallback(
    (value: string) => setPicks((current) => ({ ...current, mode: value })),
    [],
  );
  return {
    projects,
    providers,
    agents,
    agent,
    target,
    agentWorkspace,
    prNumber,
    project,
    projectConfig: settings.projects.find((entry) => entry.projectId === projectId) ?? null,
    placements,
    placement,
    chooseProject,
    choosePlacement,
    chooseAgent,
    chooseModel,
    chooseEffort,
    chooseMode,
  };
}

export type LaunchChoices = ReturnType<typeof useLaunchChoices>;
