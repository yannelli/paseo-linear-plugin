import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const AGENT_ACTIONS = ["implement", "review"] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

export const PROMPT_MODES = ["default", "append", "replace"] as const;
export type PromptMode = (typeof PROMPT_MODES)[number];

const ActionOverrideSchema = z.object({
  mode: z.enum(PROMPT_MODES).default("default"),
  text: z.string().default(""),
});

/** Extra instructions the launch adds to the prompt. Saved per project. */
export const GuidanceSchema = z.object({
  /** Keep Linear current: todos with sub-issue keys, and comments when a Linear tool exists. */
  updateLinear: z.boolean().default(false),
  /** Subagents state the issue key they work on. Claude agents also get a hook that tells them. */
  subagentKeys: z.boolean().default(false),
  /** Hand work to Paseo agents on the same provider, with thinking that fits the task. */
  paseoSubagents: z.boolean().default(false),
});
export type Guidance = z.infer<typeof GuidanceSchema>;
export const GUIDANCE_KEYS = ["updateLinear", "subagentKeys", "paseoSubagents"] as const;

export const ProjectConfigSchema = z.object({
  projectId: z.string(),
  displayName: z.string(),
  rootPath: z.string(),
  teamIds: z.array(z.string()).default([]),
  instructions: z.string().default(""),
  steps: z.array(z.string()).default([]),
  implement: ActionOverrideSchema.prefault({}),
  review: ActionOverrideSchema.prefault({}),
  guidance: GuidanceSchema.prefault({}),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

/** Settings with a project's guidance saved, adding the project when it has no entry yet. */
export function withProjectGuidance(
  values: LinearSettings,
  project: { projectId: string; displayName: string; rootPath: string },
  guidance: Guidance,
): LinearSettings {
  const known = values.projects.find((entry) => entry.projectId === project.projectId);
  return { ...values, projects: upsertProject(values, { ...(known ?? emptyProjectConfig(project)), guidance }) };
}

export const ISOLATIONS = ["worktree", "workspace"] as const;
export type Isolation = (typeof ISOLATIONS)[number];

export const MAPPING_MODES = ["semantic", "explore"] as const;
export type MappingMode = (typeof MAPPING_MODES)[number];

export const LIVE_VIEWS = ["map", "graph"] as const;
/** Auto follows the running agents; fit shows the whole graph. */
export const GRAPH_CAMERAS = ["auto", "fit"] as const;
export type GraphCamera = (typeof GRAPH_CAMERAS)[number];
export type LiveView = (typeof LIVE_VIEWS)[number];

export const linearSettings = defineSettings({
  id: "linear",
  scope: "host",
  version: 1,
  schema: z.object({
    // Empty templates mean "use the built-in prompt" so improved defaults reach existing users.
    templates: z
      .object({ implement: z.string().default(""), review: z.string().default("") })
      .prefault({}),
    launch: z
      .object({
        provider: z.string().default(""),
        isolation: z.enum(ISOLATIONS).default("worktree"),
        includeComments: z.boolean().default(true),
        moveToStarted: z.boolean().default(true),
        assignToMe: z.boolean().default(true),
      })
      .prefault({}),
    // Explore runs cost provider usage and sync writes to Linear, so both start off.
    live: z
      .object({
        enabled: z.boolean().default(true),
        mapping: z.enum(MAPPING_MODES).default("semantic"),
        exploreProvider: z.string().default(""),
        /** Thinking option of the explore model; empty is the model's default. */
        exploreEffort: z.string().default(""),
        syncTodos: z.boolean().default(false),
        view: z.enum(LIVE_VIEWS).default("map"),
        issuesCollapsed: z.boolean().default(false),
        graphCamera: z.enum(GRAPH_CAMERAS).default("auto"),
        /** The wheel and drags scroll the page instead of moving the graph. */
        graphLocked: z.boolean().default(false),
      })
      .prefault({}),
    // Where the plugin works: every project, minus or plus per-project switches.
    access: z
      .object({
        allProjects: z.boolean().default(true),
        projects: z.record(z.string(), z.boolean()).default({}),
      })
      .prefault({}),
    projects: z.array(ProjectConfigSchema).default([]),
  }),
});

export type LinearSettings = z.output<typeof linearSettings.schema>;

export function emptyProjectConfig(project: {
  projectId: string;
  displayName: string;
  rootPath: string;
}): ProjectConfig {
  return ProjectConfigSchema.parse(project);
}

export function upsertProject(
  settings: LinearSettings,
  next: ProjectConfig,
): LinearSettings["projects"] {
  const others = settings.projects.filter((entry) => entry.projectId !== next.projectId);
  return [...others, next];
}

export type ProjectAccess = LinearSettings["access"];

/** A project switch wins; projects without one follow the all-projects switch. */
export function projectEnabled(access: ProjectAccess, projectId: string | null | undefined) {
  if (!projectId) return access.allProjects;
  return access.projects[projectId] ?? access.allProjects;
}

/** Sets one project's switch, dropping it when it matches the all-projects switch. */
export function withProjectAccess(
  access: ProjectAccess,
  projectId: string,
  enabled: boolean,
): ProjectAccess {
  const { [projectId]: _previous, ...others } = access.projects;
  return {
    ...access,
    projects: enabled === access.allProjects ? others : { ...others, [projectId]: enabled },
  };
}

export const AccessSchema = z.object({
  allProjects: z.boolean(),
  projects: z.record(z.string(), z.boolean()),
});

export const accessRpc = defineRpc({
  name: "linear.access.get",
  input: z.object({}),
  output: AccessSchema,
});
