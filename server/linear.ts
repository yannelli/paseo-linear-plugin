import { z } from "zod";
import { createLinearGraphql, type LinearGraphqlOptions } from "./graphql";

const LinearIssueSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  url: z.string(),
  priorityLabel: z.string(),
  state: z.object({ name: z.string() }),
  assignee: z.object({ name: z.string() }).nullable(),
  project: z.object({ name: z.string() }).nullable(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }),
});

const ExactIssueResponseSchema = z.object({ issue: LinearIssueSchema.nullable() });
const IssueSearchResponseSchema = z.object({
  issues: z.object({ nodes: z.array(LinearIssueSchema) }),
});

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  url
  priorityLabel
  state { name }
  assignee { name }
  project { name }
  labels { nodes { name } }
`;

export const EXACT_ISSUE_QUERY = `
  query PaseoLinearIssue($id: String!) {
    issue(id: $id) { ${ISSUE_FIELDS} }
  }
`;

export const SEARCH_ISSUES_QUERY = `
  query PaseoLinearIssues($filter: IssueFilter) {
    issues(first: 20, filter: $filter, orderBy: updatedAt) {
      nodes { ${ISSUE_FIELDS} }
    }
  }
`;

const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9]+-\d+$/i;

export interface LinearAttachmentItem {
  id: string;
  identifier: string;
  title: string;
  subtitle?: string;
  url: string;
  text: string;
  resourceType: string;
}

export interface LinearIssueSearch {
  search(query: string): Promise<{ items: LinearAttachmentItem[] }>;
}

type LinearIssueSearchOptions = LinearGraphqlOptions;

function issueSubtitle(issue: z.infer<typeof LinearIssueSchema>): string | undefined {
  const parts = [issue.state.name, issue.assignee?.name].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function issueText(issue: z.infer<typeof LinearIssueSchema>): string {
  const labels = issue.labels.nodes.map((label) => label.name).join(", ");
  const lines = [
    `Linear issue ${issue.identifier}: ${issue.title}`,
    `URL: ${issue.url}`,
    `Status: ${issue.state.name}`,
    `Priority: ${issue.priorityLabel}`,
  ];
  if (issue.assignee) lines.push(`Assignee: ${issue.assignee.name}`);
  if (issue.project) lines.push(`Project: ${issue.project.name}`);
  if (labels) lines.push(`Labels: ${labels}`);
  lines.push("", issue.description ?? "No description.");
  return lines.join("\n");
}

function toAttachmentItem(issue: z.infer<typeof LinearIssueSchema>): LinearAttachmentItem {
  const subtitle = issueSubtitle(issue);
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    ...(subtitle ? { subtitle } : {}),
    url: issue.url,
    text: issueText(issue),
    resourceType: "issue",
  };
}

export function createLinearIssueSearch(options: LinearIssueSearchOptions): LinearIssueSearch {
  const graphql = createLinearGraphql(options);

  async function findExact(identifier: string): Promise<LinearAttachmentItem[]> {
    const response = ExactIssueResponseSchema.parse(
      await graphql(EXACT_ISSUE_QUERY, { id: identifier }),
    );
    return response.issue ? [toAttachmentItem(response.issue)] : [];
  }

  async function searchTitles(query: string): Promise<LinearAttachmentItem[]> {
    const filter = query ? { title: { containsIgnoreCase: query } } : null;
    const response = IssueSearchResponseSchema.parse(
      await graphql(SEARCH_ISSUES_QUERY, { filter }),
    );
    return response.issues.nodes.map(toAttachmentItem);
  }

  return {
    async search(query: string) {
      const normalized = query.trim();
      if (LINEAR_IDENTIFIER.test(normalized)) {
        return { items: await findExact(normalized.toUpperCase()) };
      }
      const items = await searchTitles(normalized);
      return { items };
    },
  };
}
