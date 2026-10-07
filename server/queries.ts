import { z } from "zod";
import {
  type IssueDetail,
  type IssuePatch,
  type IssueQuery,
  type IssueSummary,
  LINEAR_IDENTIFIER,
  STATUS_STATE_TYPES,
  UserSchema,
  WorkflowStateSchema,
} from "../shared/linear";
import type { LinearGraphql } from "./graphql";
import { LinearApiError } from "./graphql";

const USER_FIELDS = "id name displayName avatarUrl";
const STATE_FIELDS = "id name type color position";
const SUMMARY_FIELDS = `
  id identifier title url branchName priority priorityLabel updatedAt
  state { ${STATE_FIELDS} }
  assignee { ${USER_FIELDS} }
  team { id key name }
  project { id name }
  labels(first: 20) { nodes { id name color } }
`;

// Linear caps query complexity (connection sizes multiply), so the catalog asks only for
// what the UI uses: teams with their workflow states, and active users.
export const CATALOG_QUERY = `
  query PaseoLinearCatalog {
    viewer { ${USER_FIELDS} }
    organization { name urlKey }
    teams(first: 50) {
      nodes {
        id key name
        states(first: 50) { nodes { ${STATE_FIELDS} } }
      }
    }
    users(first: 250, filter: { active: { eq: true } }) { nodes { ${USER_FIELDS} } }
  }
`;

export const LIST_QUERY = `
  query PaseoLinearIssueList($filter: IssueFilter, $after: String) {
    issues(first: 50, after: $after, filter: $filter, orderBy: updatedAt) {
      nodes { ${SUMMARY_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export const DETAIL_QUERY = `
  query PaseoLinearIssueDetail($id: String!) {
    issue(id: $id) {
      ${SUMMARY_FIELDS}
      description createdAt
      creator { ${USER_FIELDS} }
      parent { id identifier title }
      children(first: 50) { nodes { id identifier title state { ${STATE_FIELDS} } } }
      comments(first: 100) { nodes { id body createdAt user { ${USER_FIELDS} } } }
      attachments(first: 25) { nodes { id title subtitle url sourceType } }
    }
  }
`;

export const UPDATE_MUTATION = `
  mutation PaseoLinearIssueUpdate($id: String!, $input: IssueUpdateInput!) {
    issueUpdate(id: $id, input: $input) { success issue { ${SUMMARY_FIELDS} } }
  }
`;

export const CREATE_MUTATION = `
  mutation PaseoLinearIssueCreate($input: IssueCreateInput!) {
    issueCreate(input: $input) { success issue { ${SUMMARY_FIELDS} } }
  }
`;

export const COMMENT_MUTATION = `
  mutation PaseoLinearCommentCreate($input: CommentCreateInput!) {
    commentCreate(input: $input) { success comment { id body createdAt user { ${USER_FIELDS} } } }
  }
`;

const nodes = <T extends z.ZodType>(schema: T) =>
  z.object({ nodes: z.array(schema) }).transform((connection) => connection.nodes);
const LabelRaw = z.object({ id: z.string(), name: z.string(), color: z.string() });
const RawSummary = z.object({
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
  labels: nodes(LabelRaw),
});
const RawComment = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
  user: UserSchema.nullable(),
});
const RawDetail = RawSummary.extend({
  description: z.string().nullable(),
  createdAt: z.string(),
  creator: UserSchema.nullable(),
  parent: z.object({ id: z.string(), identifier: z.string(), title: z.string() }).nullable(),
  children: nodes(
    z.object({
      id: z.string(),
      identifier: z.string(),
      title: z.string(),
      state: WorkflowStateSchema,
    }),
  ),
  comments: nodes(RawComment),
  attachments: nodes(
    z.object({
      id: z.string(),
      title: z.string(),
      subtitle: z.string().nullable(),
      url: z.string(),
      sourceType: z.string().nullable(),
    }),
  ),
});
const CatalogResponse = z.object({
  viewer: UserSchema,
  organization: z.object({ name: z.string(), urlKey: z.string() }),
  teams: nodes(
    z.object({
      id: z.string(),
      key: z.string(),
      name: z.string(),
      states: nodes(WorkflowStateSchema),
    }),
  ),
  users: nodes(UserSchema),
});
const ListResponse = z.object({
  issues: z.object({
    nodes: z.array(RawSummary),
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  }),
});
const IssuePayload = z.object({ success: z.boolean(), issue: RawSummary.nullable() });

export function issueFilter(query: IssueQuery): Record<string, unknown> | null {
  const clauses: Record<string, unknown>[] = [];
  if (query.teamId) clauses.push({ team: { id: { eq: query.teamId } } });
  if (query.assignee === "me") clauses.push({ assignee: { isMe: { eq: true } } });
  if (query.assignee === "unassigned") clauses.push({ assignee: { null: true } });
  const types = STATUS_STATE_TYPES[query.status];
  if (types) clauses.push({ state: { type: { in: [...types] } } });
  const text = query.query.trim();
  if (text) {
    clauses.push({
      or: [{ title: { containsIgnoreCase: text } }, { description: { containsIgnoreCase: text } }],
    });
  }
  return clauses.length > 0 ? { and: clauses } : null;
}

function sortStates<T extends { states: { position: number }[] }>(team: T): T {
  return { ...team, states: [...team.states].sort((a, b) => a.position - b.position) };
}

export function createLinearService(graphql: LinearGraphql) {
  async function getIssue(id: string): Promise<IssueDetail | null> {
    const data = z
      .object({ issue: RawDetail.nullable() })
      .parse(await graphql(DETAIL_QUERY, { id }));
    if (!data.issue) return null;
    const comments = [...data.issue.comments].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    return { ...data.issue, comments };
  }

  function requireIssue(payload: z.infer<typeof IssuePayload>, action: string): IssueSummary {
    if (!payload.success || !payload.issue) throw new LinearApiError(`Linear could not ${action}`);
    return payload.issue;
  }

  return {
    async catalog() {
      const data = CatalogResponse.parse(await graphql(CATALOG_QUERY));
      return { ...data, teams: data.teams.map(sortStates) };
    },
    async listIssues(query: IssueQuery) {
      const text = query.query.trim();
      if (LINEAR_IDENTIFIER.test(text) && !query.after) {
        const issue = await getIssue(text.toUpperCase()).catch(() => null);
        if (issue) return { issues: [issue], endCursor: null, hasNextPage: false };
      }
      const data = ListResponse.parse(
        await graphql(LIST_QUERY, { filter: issueFilter(query), after: query.after }),
      );
      return {
        issues: data.issues.nodes,
        endCursor: data.issues.pageInfo.endCursor,
        hasNextPage: data.issues.pageInfo.hasNextPage,
      };
    },
    async getIssue(id: string) {
      const issue = await getIssue(id);
      if (!issue) throw new LinearApiError(`Linear issue ${id} was not found`);
      return issue;
    },
    async updateIssue(id: string, patch: IssuePatch) {
      const data = z
        .object({ issueUpdate: IssuePayload })
        .parse(await graphql(UPDATE_MUTATION, { id, input: patch }));
      return requireIssue(data.issueUpdate, "update the issue");
    },
    async createIssue(input: Record<string, unknown>) {
      const data = z
        .object({ issueCreate: IssuePayload })
        .parse(await graphql(CREATE_MUTATION, { input }));
      return requireIssue(data.issueCreate, "create the issue");
    },
    async createComment(issueId: string, body: string) {
      const data = z
        .object({
          commentCreate: z.object({ success: z.boolean(), comment: RawComment.nullable() }),
        })
        .parse(await graphql(COMMENT_MUTATION, { input: { issueId, body } }));
      if (!data.commentCreate.success || !data.commentCreate.comment) {
        throw new LinearApiError("Linear could not add the comment");
      }
      return data.commentCreate.comment;
    },
  };
}

export type LinearService = ReturnType<typeof createLinearService>;
