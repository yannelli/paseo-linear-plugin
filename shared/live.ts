import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { McpHttpServerSchema, ToolPolicySchema } from "./agent-tools";
import { IssueCardSchema, WorkflowStateSchema } from "./linear";

// Contracts for Linear Live, todo sync, and project setup. Agents the plugin starts for itself
// carry their own labels so they get no pill, no sync, and no place in the linked agent list.

export const MapFileSchema = z.object({
  path: z.string().min(1),
  /** Issue key the file belongs to: the parent or one of its sub-issues. */
  issue: z.string().min(1),
});
export type MapFile = z.infer<typeof MapFileSchema>;

export const IssueMapSchema = z.object({
  identifier: z.string(),
  source: z.enum(["semantic", "explore"]),
  files: z.array(MapFileSchema),
  createdAt: z.string(),
});
export type IssueMap = z.infer<typeof IssueMapSchema>;

export const JobSchema = z.object({
  id: z.string(),
  status: z.enum(["running", "done", "failed"]),
  agentId: z.string().nullable(),
  error: z.string().nullable(),
  startedAt: z.string(),
});
export type Job = z.infer<typeof JobSchema>;

/** What the explore agent must return. */
export const ExploreResultSchema = z.object({
  files: z.array(z.object({ path: z.string().min(1), issue: z.string().min(1) })).max(200),
});

export const InitProposalSchema = z.object({
  instructions: z.string().default(""),
  steps: z.array(z.string()).default([]),
  implement: z.string().default(""),
  review: z.string().default(""),
});
export type InitProposal = z.infer<typeof InitProposalSchema>;

/** Files an explore run may list; the map and the graph show this many and more. */
export const MAX_EXPLORE_FILES = 150;
export const MAX_LIST_DIRS = 40;
export const MAX_DIR_ENTRIES = 60;

export const listFilesRpc = defineRpc({
  name: "linear.live.files",
  input: z.object({ agentId: z.string().min(1), dirs: z.array(z.string()).max(MAX_LIST_DIRS) }),
  output: z.object({
    dirs: z.array(z.object({ dir: z.string(), files: z.array(z.string()), truncated: z.boolean() })),
  }),
});

export const MAX_LINK_FILES = 200;

/** Imports and other links between the files on the graph. */
export const linksRpc = defineRpc({
  name: "linear.live.links",
  input: z.object({ agentId: z.string().min(1), files: z.array(z.string().min(1)).max(MAX_LINK_FILES) }),
  output: z.object({
    links: z.array(z.object({ from: z.string(), to: z.string(), kind: z.enum(["import", "link", "mention"]) })),
  }),
});

const SubagentLogSchema = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  /** The parent's call that started it, when Claude recorded one. */
  toolUseId: z.string().nullable(),
  updatedAt: z.number(),
  /** Its last reply ended the run. */
  finished: z.boolean(),
  items: z.array(
    z.object({
      type: z.literal("tool_call"),
      callId: z.string(),
      name: z.string(),
      status: z.enum(["running", "completed", "failed"]),
      detail: z.record(z.string(), z.unknown()),
    }),
  ),
});
export type SubagentLog = z.infer<typeof SubagentLogSchema>;

/** Tool calls of the subagents an agent started inside its provider. */
export const subagentLogsRpc = defineRpc({
  name: "linear.live.subagents",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ runs: z.array(SubagentLogSchema) }),
});

/** Forgets the saved explore map of the agent's issue, so the map falls back to ticket text. */
export const clearMapRpc = defineRpc({
  name: "linear.live.map.clear",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ cleared: z.boolean() }),
});

export const liveMapRpc = defineRpc({
  name: "linear.live.map",
  input: z.object({ identifier: z.string().min(1) }),
  output: z.object({ map: IssueMapSchema.nullable(), job: JobSchema.nullable() }),
});

export const exploreRpc = defineRpc({
  name: "linear.live.explore",
  input: z.object({ agentId: z.string().min(1), force: z.boolean().default(false) }),
  output: z.object({ job: JobSchema }),
});

export const LaunchConfigSchema = z.object({
  provider: z.string().min(1),
  thinkingOptionId: z.string().optional(),
  modeId: z.string().optional(),
  /** Only the folder of the issue's Claude Code hooks; see agent-hooks.ts. */
  providerOptions: z.object({ extraArgs: z.object({ "plugin-dir": z.string().min(1) }) }).optional(),
  /** Only the plugin's own MCP server; see agent-tools.ts. */
  mcpServers: z.object({ linear: McpHttpServerSchema }).optional(),
  toolPolicy: ToolPolicySchema.optional(),
});

// The daemon maps the files first and then starts the agent, so closing the app mid-way
// still starts it. With a saved map, or when exploring cannot start, the agent starts now.
export const LaunchInputSchema = z.object({
  workspaceId: z.string().min(1),
  identifier: z.string().min(1),
  keyScope: z.string().nullable(),
  agent: z.object({
    config: LaunchConfigSchema,
    title: z.string(),
    prompt: z.string(),
    labels: z.record(z.string(), z.string()),
  }),
  card: IssueCardSchema,
});
export type LaunchInput = z.infer<typeof LaunchInputSchema>;

export const launchAfterExploreRpc = defineRpc({
  name: "linear.live.launch",
  input: LaunchInputSchema,
  output: z.object({ agentId: z.string().nullable(), job: JobSchema }),
});

export const SyncMoveSchema = z.object({
  identifier: z.string(),
  from: WorkflowStateSchema,
  to: WorkflowStateSchema,
});

export const syncNowRpc = defineRpc({
  name: "linear.sync.now",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ moves: z.array(SyncMoveSchema), skipped: z.string().nullable() }),
});

export const initStartRpc = defineRpc({
  name: "linear.init.start",
  input: z.object({ projectId: z.string().min(1), rootPath: z.string().min(1) }),
  output: z.object({ job: JobSchema }),
});

export const initStatusRpc = defineRpc({
  name: "linear.init.status",
  input: z.object({ jobId: z.string().min(1) }),
  output: z.object({ job: JobSchema.nullable(), proposal: InitProposalSchema.nullable() }),
});

const EXTENSIONS =
  "ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|hpp|cs|php|vue|svelte|css|scss|html|md|mdx|json|ya?ml|toml|sql|sh|prisma|graphql";
const PATH = new RegExp(
  `(?:^|[\\s\`'"(\\[])((?:[\\w@.-]+/)*[\\w@.-]+\\.(?:${EXTENSIONS}))(?=$|[\\s\`'")\\],.:;!?])`,
  "g",
);
const DIRECTORY = /`((?:[\w@.-]+\/)+)`/g;
const ISSUE_KEY = /\b[A-Z][A-Z0-9]*-\d+\b/g;

export function pathsIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(PATH)) if (match[1]) found.add(match[1].replace(/^\.\//, ""));
  for (const match of text.matchAll(DIRECTORY)) if (match[1]) found.add(match[1]);
  return [...found].filter((path) => !/^https?:/.test(path) && !path.includes("//"));
}

export interface SemanticIssue {
  identifier: string;
  title: string;
  description: string | null;
  children: readonly { identifier: string; title: string }[];
}

// Linear sends sub-issue titles but not their descriptions, so a path in the parent's text
// belongs to the sub-issue its line names and otherwise to the parent.
export function semanticMap(issue: SemanticIssue, now = new Date()): IssueMap {
  const owners = new Map<string, string>();
  const childKeys = new Set(issue.children.map((child) => child.identifier.toUpperCase()));
  for (const child of issue.children) {
    for (const path of pathsIn(child.title)) owners.set(path, child.identifier);
  }
  const lines = `${issue.title}\n${issue.description ?? ""}`.split("\n");
  for (const line of lines) {
    const named = (line.match(ISSUE_KEY) ?? []).find((key) => childKeys.has(key));
    for (const path of pathsIn(line)) {
      if (!owners.has(path)) owners.set(path, named ?? issue.identifier);
    }
  }
  return {
    identifier: issue.identifier,
    source: "semantic",
    files: [...owners].map(([path, owner]) => ({ path, issue: owner })),
    createdAt: now.toISOString(),
  };
}

/** Parses the last JSON object in an agent reply: a fenced block, the whole text, or braces. */
export function lastJsonObject(reply: string): unknown {
  const fences = [...reply.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].reverse();
  const candidates = [...fences.map((match) => match[1] ?? ""), reply.trim()];
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(reply.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // Not JSON; try the next candidate.
    }
  }
  return null;
}

/** Directory of a repo path, with a trailing slash, or "" for the root. */
export function dirOf(path: string): string {
  if (path.endsWith("/")) return path;
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index + 1);
}
