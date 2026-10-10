import { usePaseo } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import type { IssueDetail } from "../shared/linear";
import { type AgentAction, type LinearSettings, projectDefaults, projectEnabled } from "../shared/settings";
import { type AgentPicks, resolveAgent } from "./agent-options";
import { loadAgentPreferences } from "./agent-preferences";
import {
  defaultProjectId,
  type Placement,
  placementOptions,
  pullRequestNumber,
  resolvePlacement,
  type TargetWorkspace,
} from "./launch-plan";
import { useLinkedAgents, useProjects, useProviders } from "./queries";

// `useWorkspace` works only inside a workspace panel, so look the workspace up by id instead.
function useWorkspaceById(workspaceId: string | null) {
  const paseo = usePaseo();
  return (
    useQuery({
      queryKey: ["linear", "workspace", workspaceId],
      enabled: workspaceId !== null,
      staleTime: 60_000,
      queryFn: async (): Promise<TargetWorkspace | null> => {
        const { entries } = await paseo.workspaces.list();
        const match = entries.find((entry) => entry.id === workspaceId);
        return match ? { id: match.id, projectId: match.projectId, name: match.name } : null;
      },
    }).data ?? null
  );
}

const NO_PICKS: AgentPicks = { agent: null, model: null, effort: null, mode: null };

export function useLaunchChoices(input: {
  issue: IssueDetail;
  action: AgentAction;
  settings: LinearSettings;
  target: TargetWorkspace | null;
}) {
  const { issue, settings, action } = input;
  const allProjects = useProjects();
  // Projects where Linear is off are not offered as launch targets.
  const projects = useMemo(
    () => ({
      ...allProjects,
      data: allProjects.data?.filter((entry) => projectEnabled(settings.access, entry.projectId)),
    }),
    [allProjects, settings.access],
  );
  const providers = useProviders();
  const { target } = input;
  const prNumber = action === "review" ? pullRequestNumber(issue) : null;
  const linked = useLinkedAgents(issue.identifier);
  const agentWorkspaceId =
    linked.data?.find((agent) => agent.action === "implement" && agent.workspaceId)?.workspaceId ??
    null;
  const agentWorkspace = useWorkspaceById(agentWorkspaceId);
  const [projectChoice, setProjectChoice] = useState<string | null>(null);
  const [placementChoice, setPlacementChoice] = useState<Placement | null>(null);
  const [picks, setPicks] = useState<AgentPicks>(NO_PICKS);
  const [remembered] = useState(loadAgentPreferences);
  const preferredId =
    projectChoice ??
    defaultProjectId({ target, teamId: issue.team.id, settings, projects: projects.data });
  const project =
    projects.data?.find((entry) => entry.projectId === preferredId) ??
    (projectChoice ? null : (projects.data?.[0] ?? null));
  const projectId = project?.projectId ?? preferredId;
  const defaults = projectDefaults(settings, projectId);
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
    defaults.launch.isolation,
  );
  const agents = providers.data ?? [];
  const agent = resolveAgent(agents, picks, defaults.launch.provider, remembered);
  const chooseProject = useCallback((value: string) => {
    setProjectChoice(value);
    setPlacementChoice(null);
  }, []);
  const choosePlacement = useCallback(
    (value: string) => setPlacementChoice(value as Placement),
    [],
  );
  // A model from another agent starts from that agent's default effort and mode.
  const chooseModel = useCallback(
    (agentId: string, modelId: string) =>
      setPicks((current) =>
        current.agent === agentId || (current.agent === null && agent?.agent.id === agentId)
          ? { ...current, agent: agentId, model: modelId, effort: null }
          : { ...NO_PICKS, agent: agentId, model: modelId },
      ),
    [agent?.agent.id],
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
    /** Launch and tool settings with the project's own values applied. */
    defaults,
    remembered,
    placements,
    placement,
    chooseProject,
    choosePlacement,
    chooseModel,
    chooseEffort,
    chooseMode,
  };
}

export type LaunchChoices = ReturnType<typeof useLaunchChoices>;
