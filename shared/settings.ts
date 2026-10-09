import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { IconSettingsSchema } from "./custom-icon";

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

export const ISOLATIONS = ["worktree", "workspace"] as const;
export type Isolation = (typeof ISOLATIONS)[number];

/** The most agents the agent limit setting offers; 0 means no limit. */
export const MAX_AGENTS_LIMIT = 16;
const AgentLimit = z.number().int().min(0).max(MAX_AGENTS_LIMIT);

/** The plugin's linear MCP server, and the agents its start_agent tool starts. */
export const ToolSettingsSchema = z.object({
  /** Agents started from an issue get the linear MCP server when their options need it. */
  enabled: z.boolean().default(true),
  /** The edit_issue tool, which changes issue descriptions. */
  allowEdits: z.boolean().default(true),
  /** The launch page offers an agent for each sub-issue. */
  assignAgents: z.boolean().default(true),
  /** Agents that one launch may run at the same time with start_agent; 0 has no limit. */
  maxAgents: AgentLimit.default(0),
});
export type ToolSettings = z.infer<typeof ToolSettingsSchema>;

/** A project's own values. A missing value follows the setting for all projects. */
export const ProjectOverridesSchema = z.object({
  provider: z.string().optional(),
  isolation: z.enum(ISOLATIONS).optional(),
  includeComments: z.boolean().optional(),
  moveToStarted: z.boolean().optional(),
  assignToMe: z.boolean().optional(),
  syncTodos: z.boolean().optional(),
  tools: z.boolean().optional(),
  allowEdits: z.boolean().optional(),
  assignAgents: z.boolean().optional(),
  maxAgents: AgentLimit.optional(),
});
export type ProjectOverrides = z.infer<typeof ProjectOverridesSchema>;

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
  overrides: ProjectOverridesSchema.prefault({}),
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

export const MAPPING_MODES = ["semantic", "explore"] as const;
export type MappingMode = (typeof MAPPING_MODES)[number];

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
        issuesCollapsed: z.boolean().default(false),
      })
      .prefault({}),
    tools: ToolSettingsSchema.prefault({}),
    // Where the plugin works: every project, minus or plus per-project switches.
    access: z
      .object({
        allProjects: z.boolean().default(true),
        projects: z.record(z.string(), z.boolean()).default({}),
      })
      .prefault({}),
    projects: z.array(ProjectConfigSchema).default([]),
    /** The icon of pills and other plugin places: built-in or the user's SVG. */
    icon: IconSettingsSchema.prefault({}),
  }),
});

export type LinearSettings = z.output<typeof linearSettings.schema>;

/** The settings that a project can change, with its own values applied. */
export interface ProjectDefaults {
  launch: LinearSettings["launch"];
  syncTodos: boolean;
  tools: ToolSettings;
}

export function projectDefaults(values: LinearSettings, projectId: string | null | undefined): ProjectDefaults {
  const own = (projectId ? values.projects.find((entry) => entry.projectId === projectId)?.overrides : undefined) ?? {};
  const { launch, tools } = values;
  return {
    launch: {
      provider: own.provider ?? launch.provider,
      isolation: own.isolation ?? launch.isolation,
      includeComments: own.includeComments ?? launch.includeComments,
      moveToStarted: own.moveToStarted ?? launch.moveToStarted,
      assignToMe: own.assignToMe ?? launch.assignToMe,
    },
    syncTodos: own.syncTodos ?? values.live.syncTodos,
    tools: {
      enabled: own.tools ?? tools.enabled,
      allowEdits: own.allowEdits ?? tools.allowEdits,
      assignAgents: own.assignAgents ?? tools.assignAgents,
      maxAgents: own.maxAgents ?? tools.maxAgents,
    },
  };
}

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
