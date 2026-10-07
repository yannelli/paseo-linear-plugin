import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const AGENT_ACTIONS = ["implement", "review"] as const;
export type AgentAction = (typeof AGENT_ACTIONS)[number];

export const PROMPT_MODES = ["default", "append", "replace"] as const;
export type PromptMode = (typeof PROMPT_MODES)[number];

const ActionOverrideSchema = z.object({
  mode: z.enum(PROMPT_MODES).default("default"),
  text: z.string().default(""),
});

export const ProjectConfigSchema = z.object({
  projectId: z.string(),
  displayName: z.string(),
  rootPath: z.string(),
  teamIds: z.array(z.string()).default([]),
  instructions: z.string().default(""),
  steps: z.array(z.string()).default([]),
  implement: ActionOverrideSchema.prefault({}),
  review: ActionOverrideSchema.prefault({}),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export const ISOLATIONS = ["worktree", "workspace"] as const;
export type Isolation = (typeof ISOLATIONS)[number];

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
