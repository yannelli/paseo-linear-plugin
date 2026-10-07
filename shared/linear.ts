import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});

export const WorkflowStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  color: z.string(),
  position: z.number(),
});

export const LabelSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
});

export const TeamSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  states: z.array(WorkflowStateSchema),
});

export const IssueRefSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
});

export const IssueSummarySchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  url: z.string(),
  branchName: z.string(),
  priority: z.number(),
  priorityLabel: z.string(),
  updatedAt: z.string(),
  state: WorkflowStateSchema,
  assignee: UserSchema.nullable(),
  team: z.object({ id: z.string(), key: z.string(), name: z.string() }),
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  labels: z.array(LabelSchema),
  parent: IssueRefSchema.nullable(),
});

export const CommentSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
  user: UserSchema.nullable(),
});

export const IssueAttachmentSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().nullable(),
  url: z.string(),
  sourceType: z.string().nullable(),
});

export const IssueDetailSchema = IssueSummarySchema.extend({
  description: z.string().nullable(),
  createdAt: z.string(),
  creator: UserSchema.nullable(),
  // Parent chain, root first. The last entry is the direct parent.
  ancestors: z.array(IssueRefSchema),
  children: z.array(
    z.object({
      id: z.string(),
      identifier: z.string(),
      title: z.string(),
      state: WorkflowStateSchema,
    }),
  ),
  comments: z.array(CommentSchema),
  attachments: z.array(IssueAttachmentSchema),
});

export type LinearUser = z.infer<typeof UserSchema>;
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
export type LinearLabel = z.infer<typeof LabelSchema>;
export type LinearTeam = z.infer<typeof TeamSchema>;
export type IssueSummary = z.infer<typeof IssueSummarySchema>;
export type IssueDetail = z.infer<typeof IssueDetailSchema>;
export type IssueComment = z.infer<typeof CommentSchema>;
export type IssueRef = z.infer<typeof IssueRefSchema>;

// The Paseo project whose Linear key to use. Null or absent uses the default key.
const KeyScope = { projectId: z.string().min(1).nullable().optional() };
export type KeyScopeInput = { projectId?: string | null };

const KeySourceSchema = z.enum(["project", "file", "environment"]);
export type KeySource = z.infer<typeof KeySourceSchema>;

export const authStatusRpc = defineRpc({
  name: "linear.auth.status",
  input: z.object(KeyScope),
  output: z.object({
    configured: z.boolean(),
    source: KeySourceSchema.nullable(),
    keyHint: z.string().nullable(),
    projectKeys: z.array(z.object({ projectId: z.string(), keyHint: z.string() })),
  }),
});

export const authSaveRpc = defineRpc({
  name: "linear.auth.save",
  input: z.object({ apiKey: z.string().trim().min(1, "Paste a Linear API key"), ...KeyScope }),
  output: z.object({ viewerName: z.string(), organizationName: z.string() }),
});

export const authClearRpc = defineRpc({
  name: "linear.auth.clear",
  input: z.object(KeyScope),
  output: z.object({ configured: z.boolean() }),
});

export const CatalogSchema = z.object({
  viewer: UserSchema,
  organization: z.object({ name: z.string(), urlKey: z.string() }),
  teams: z.array(TeamSchema),
  users: z.array(UserSchema),
});
export type Catalog = z.infer<typeof CatalogSchema>;

export const catalogRpc = defineRpc({
  name: "linear.catalog",
  input: z.object(KeyScope),
  output: CatalogSchema,
});

export const ASSIGNEE_FILTERS = ["me", "anyone", "unassigned"] as const;
export const STATUS_FILTERS = ["active", "backlog", "done", "all"] as const;
export const ISSUE_SORTS = ["updated", "created", "priority", "due", "title"] as const;
export type AssigneeFilter = (typeof ASSIGNEE_FILTERS)[number];
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export type IssueSort = (typeof ISSUE_SORTS)[number];

export const IssueQuerySchema = z.object({
  teamId: z.string().nullable(),
  assignee: z.enum(ASSIGNEE_FILTERS),
  status: z.enum(STATUS_FILTERS),
  query: z.string(),
  sort: z.enum(ISSUE_SORTS).default("updated"),
  after: z.string().nullable(),
});
export type IssueQuery = z.input<typeof IssueQuerySchema>;

export const IssuePageSchema = z.object({
  issues: z.array(IssueSummarySchema),
  endCursor: z.string().nullable(),
  hasNextPage: z.boolean(),
});
export type IssuePage = z.infer<typeof IssuePageSchema>;

export const listIssuesRpc = defineRpc({
  name: "linear.issues.list",
  input: IssueQuerySchema.extend(KeyScope),
  output: IssuePageSchema,
});

export const getIssueRpc = defineRpc({
  name: "linear.issue.get",
  input: z.object({ id: z.string().min(1), ...KeyScope }),
  output: z.object({ issue: IssueDetailSchema }),
});

// Stale-while-revalidate: the daemon returns its last response without calling Linear.
const cached = <T extends z.ZodType>(schema: T) =>
  z.object({ value: schema.nullable(), fetchedAt: z.string().nullable() });

export const cachedCatalogRpc = defineRpc({
  name: "linear.cache.catalog",
  input: z.object(KeyScope),
  output: cached(CatalogSchema),
});

export const cachedIssuesRpc = defineRpc({
  name: "linear.cache.issues",
  input: IssueQuerySchema.extend(KeyScope),
  output: cached(IssuePageSchema),
});

export const cachedIssueRpc = defineRpc({
  name: "linear.cache.issue",
  input: z.object({ id: z.string().min(1), ...KeyScope }),
  output: cached(z.object({ issue: IssueDetailSchema })),
});

export const IssuePatchSchema = z.object({
  stateId: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
  priority: z.number().int().min(0).max(4).optional(),
  title: z.string().trim().min(1).optional(),
  description: z.string().optional(),
  labelIds: z.array(z.string()).optional(),
});
export type IssuePatch = z.infer<typeof IssuePatchSchema>;

export const updateIssueRpc = defineRpc({
  name: "linear.issue.update",
  input: z.object({ id: z.string().min(1), patch: IssuePatchSchema, ...KeyScope }),
  output: z.object({ issue: IssueSummarySchema }),
});

export const createIssueRpc = defineRpc({
  name: "linear.issue.create",
  input: z.object({
    teamId: z.string().min(1),
    title: z.string().trim().min(1, "Enter a title"),
    description: z.string().optional(),
    priority: z.number().int().min(0).max(4).optional(),
    assigneeId: z.string().nullable().optional(),
    stateId: z.string().optional(),
    linearProjectId: z.string().nullable().optional(),
    ...KeyScope,
  }),
  output: z.object({ issue: IssueSummarySchema }),
});

export const createCommentRpc = defineRpc({
  name: "linear.comment.create",
  input: z.object({ issueId: z.string().min(1), body: z.string().trim().min(1), ...KeyScope }),
  output: z.object({ comment: CommentSchema }),
});

export const PRIORITIES = [
  { value: 0, label: "No priority", icon: "Minus" },
  { value: 1, label: "Urgent", icon: "TriangleAlert" },
  { value: 2, label: "High", icon: "SignalHigh" },
  { value: 3, label: "Medium", icon: "SignalMedium" },
  { value: 4, label: "Low", icon: "SignalLow" },
] as const;

export const STATUS_STATE_TYPES: Record<StatusFilter, readonly string[] | null> = {
  active: ["unstarted", "started"],
  backlog: ["triage", "backlog"],
  done: ["completed", "canceled", "duplicate"],
  all: null,
};

export const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9]+-\d+$/i;

export const IssueCardSchema = z.object({
  identifier: z.string(),
  title: z.string(),
  url: z.string(),
  stateName: z.string(),
  stateColor: z.string(),
  action: z.enum(["implement", "review"]),
});
export type IssueCard = z.infer<typeof IssueCardSchema>;
export const ISSUE_CARD_KIND = "linear-issue";

export const attachIssueCardRpc = defineRpc({
  name: "linear.timeline.attach",
  input: z.object({ agentId: z.string().min(1), card: IssueCardSchema }),
  output: z.object({ attached: z.boolean() }),
});
