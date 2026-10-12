import {
  CommentIssueInput,
  CreateIssueInput,
  EditIssueInput,
  editText,
  isProjectScope,
  issueText,
  type ProjectScope,
  ReadIssueInput,
  SearchIssuesInput,
  taskCount,
  type ToolScope,
  UpdateIssueInput,
} from "../shared/agent-tools";
import type { Catalog, IssueDetail, IssuePatch, IssueSummary } from "../shared/linear";
import type { ToolSettings } from "../shared/settings";
import type { LinearAccess } from "./handlers";
import { type McpTool, tool } from "./mcp-http";
import type { LinearService } from "./queries";

// The Linear tools of the plugin's MCP server. Issue tools reach the issue an agent started
// from and its sub-issues. Project tools reach every issue of the project's Linear key.

const CATALOG_MAX_AGE_MS = 10 * 60_000;

/** What the issue tools need to know about the agent that calls them. */
export interface IssueCaller {
  scope: ToolScope | ProjectScope;
  tools: ToolSettings;
}

/** The Paseo project whose Linear key the tools use. */
export const keyScopeOf = (scope: ToolScope | ProjectScope) => (isProjectScope(scope) ? scope.projectId : scope.keyScope);

/** The root issue or one of its sub-issues; any other key is refused. */
async function treeIssue(linear: LinearService, scope: ToolScope, key: string | undefined) {
  const wanted = (key ?? scope.home).toUpperCase();
  const root = await linear.getIssue(scope.root);
  if (wanted === root.identifier.toUpperCase()) return root;
  if (!root.children.some((child) => child.identifier.toUpperCase() === wanted)) {
    throw new Error(`${wanted} is not ${root.identifier} or one of its sub-issues.`);
  }
  return linear.getIssue(wanted);
}

/** The issue a tool works on: any issue for project tools, the issue tree for the others. */
function scopedIssue(linear: LinearService, scope: ToolScope | ProjectScope, key: string | undefined) {
  if (!isProjectScope(scope)) return treeIssue(linear, scope, key);
  if (!key) return Promise.reject(new Error("Give the issue key, such as ENG-12."));
  return linear.getIssue(key.toUpperCase());
}

export function stateNamed(catalog: Catalog, teamId: string, name: string) {
  const team = catalog.teams.find((entry) => entry.id === teamId);
  const states = team?.states ?? [];
  const state = states.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (!state) {
    throw new Error(`${team?.key ?? "The team"} has no status "${name}". Its statuses: ${states.map((entry) => entry.name).join(", ")}.`);
  }
  return state;
}

/** The user id for "me", a display name, or a full name; null removes the assignee. */
export function userNamed(catalog: Catalog, name: string | null): string | null {
  if (name === null) return null;
  const wanted = name.toLowerCase();
  if (wanted === "me") return catalog.viewer.id;
  const matches = catalog.users.filter(
    (user) => user.displayName.toLowerCase() === wanted || user.name.toLowerCase() === wanted,
  );
  const [user] = matches;
  if (!user) throw new Error(`No active Linear user is named "${name}".`);
  if (matches.length > 1) throw new Error(`More than one Linear user is named "${name}". Use the full name.`);
  return user.id;
}

export function teamKeyed(catalog: Catalog, key: string) {
  const team = catalog.teams.find((entry) => entry.key.toUpperCase() === key.toUpperCase());
  if (!team) throw new Error(`No team has the key ${key}. Teams: ${catalog.teams.map((entry) => entry.key).join(", ")}.`);
  return team;
}

function summaryText(verb: string, issue: IssueSummary): string {
  return [
    `${verb} ${issue.identifier}: ${issue.title}`,
    `Status: ${issue.state.name}`,
    `Assignee: ${issue.assignee?.displayName ?? "none"}`,
    `Priority: ${issue.priorityLabel}`,
    `URL: ${issue.url}`,
  ].join("\n");
}

export function issueTools(access: LinearAccess): McpTool<IssueCaller>[] {
  // One edit per issue at a time, so two agents that check off items never undo each other.
  const edits = new Map<string, Promise<unknown>>();
  function oneAtATime<T>(key: string, run: () => Promise<T>): Promise<T> {
    const next = (edits.get(key) ?? Promise.resolve()).catch(() => undefined).then(run);
    edits.set(key, next);
    const forget = () => {
      if (edits.get(key) === next) edits.delete(key);
    };
    next.then(forget, forget);
    return next;
  }
  // Statuses and users change rarely, so each key's catalog is kept for a few minutes.
  const catalogs = new Map<string, { at: number; value: Catalog }>();
  async function catalogOf(keyScope: string | null): Promise<Catalog> {
    const { linear, fingerprint } = await access.connect(keyScope);
    const cached = catalogs.get(fingerprint);
    if (cached && Date.now() - cached.at < CATALOG_MAX_AGE_MS) return cached.value;
    const value = await linear.catalog();
    catalogs.set(fingerprint, { at: Date.now(), value });
    return value;
  }
  const canChange = (caller: IssueCaller) => caller.tools.allowEdits;

  return [
    tool({
      name: "read_issue",
      description: "Read a Linear issue: status, assignee, description with its task list, and sub-issues.",
      input: ReadIssueInput,
      async run(input, caller) {
        const { linear } = await access.connect(keyScopeOf(caller.scope));
        return issueText(await scopedIssue(linear, caller.scope, input.issue));
      },
    }),
    tool({
      name: "search_issues",
      description: "Find Linear issues by words in the title or description, status, assignee, and team.",
      input: SearchIssuesInput,
      allowed: (caller) => isProjectScope(caller.scope),
      async run(input, caller) {
        const keyScope = keyScopeOf(caller.scope);
        const teamId = input.team ? teamKeyed(await catalogOf(keyScope), input.team).id : null;
        const { linear } = await access.connect(keyScope);
        const page = await linear.listIssues({ query: input.query, status: input.status, assignee: input.assignee, teamId, after: null });
        if (page.issues.length === 0) return "No issues match.";
        const lines = page.issues.map(
          (issue) => `- ${issue.identifier} [${issue.state.name}] ${issue.title}${issue.assignee ? ` (${issue.assignee.displayName})` : ""}`,
        );
        if (page.hasNextPage) lines.push("More issues match. Narrow the search to see them.");
        return lines.join("\n");
      },
    }),
    tool({
      name: "edit_issue",
      description:
        "Change the description of a Linear issue. Replace exact text, for example `- [ ] Add the form` with `- [x] Add the form` to check off a task list item.",
      input: EditIssueInput,
      allowed: canChange,
      run(input, caller) {
        const keyScope = keyScopeOf(caller.scope);
        const home = isProjectScope(caller.scope) ? "" : caller.scope.home;
        const key = `${keyScope ?? ""}:${(input.issue ?? home).toUpperCase()}`;
        return oneAtATime(key, () =>
          access.mutate(keyScope, async (linear) => {
            const issue = await scopedIssue(linear, caller.scope, input.issue);
            const edited = editText(issue.description ?? "", input.old_text, input.new_text);
            if ("error" in edited) throw new Error(edited.error);
            await linear.updateIssue(issue.id, { description: edited.body });
            const tasks = taskCount(edited.body);
            const count = tasks.total > 0 ? ` ${tasks.done} of ${tasks.total} task list items are checked.` : "";
            return `Updated the description of ${issue.identifier}.${count}`;
          }),
        );
      },
    }),
    tool({
      name: "update_issue",
      description: "Change the status, assignee, priority, or title of a Linear issue.",
      input: UpdateIssueInput,
      allowed: canChange,
      async run(input, caller) {
        const keyScope = keyScopeOf(caller.scope);
        const catalog = await catalogOf(keyScope);
        return access.mutate(keyScope, async (linear) => {
          const issue = await scopedIssue(linear, caller.scope, input.issue);
          const patch: IssuePatch = {};
          if (input.status !== undefined) patch.stateId = stateNamed(catalog, issue.team.id, input.status).id;
          if (input.assignee !== undefined) patch.assigneeId = userNamed(catalog, input.assignee);
          if (input.priority !== undefined) patch.priority = input.priority;
          if (input.title !== undefined) patch.title = input.title;
          if (Object.keys(patch).length === 0) throw new Error("Give a status, assignee, priority, or title.");
          return summaryText("Updated", await linear.updateIssue(issue.id, patch));
        });
      },
    }),
    tool({
      name: "comment_issue",
      description: "Add a comment to a Linear issue.",
      input: CommentIssueInput,
      allowed: canChange,
      run(input, caller) {
        return access.mutate(keyScopeOf(caller.scope), async (linear) => {
          const issue = await scopedIssue(linear, caller.scope, input.issue);
          await linear.createComment(issue.id, input.body);
          return `Added a comment to ${issue.identifier}.`;
        });
      },
    }),
    tool({
      name: "create_issue",
      description:
        "Create a Linear issue. Give a parent to create a sub-issue. Agents started from an issue create sub-issues of that issue.",
      input: CreateIssueInput,
      allowed: canChange,
      async run(input, caller) {
        const { scope } = caller;
        const keyScope = keyScopeOf(scope);
        const catalog = await catalogOf(keyScope);
        return access.mutate(keyScope, async (linear) => {
          let parent: IssueDetail | null = null;
          if (!isProjectScope(scope)) {
            const root = scope.root.toUpperCase();
            if (input.parent && input.parent.toUpperCase() !== root) {
              throw new Error(`New issues must be sub-issues of ${root}, the issue you started from.`);
            }
            parent = await linear.getIssue(root);
          } else if (input.parent) parent = await linear.getIssue(input.parent.toUpperCase());
          const team = input.team
            ? teamKeyed(catalog, input.team)
            : (catalog.teams.find((entry) => entry.id === parent?.team.id) ?? (catalog.teams.length === 1 ? catalog.teams[0] : null));
          if (!team) throw new Error(`Give the team key: ${catalog.teams.map((entry) => entry.key).join(", ")}.`);
          const created = await linear.createIssue({
            teamId: team.id,
            title: input.title,
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(parent ? { parentId: parent.id } : {}),
            ...(input.status !== undefined ? { stateId: stateNamed(catalog, team.id, input.status).id } : {}),
            ...(input.assignee !== undefined ? { assigneeId: userNamed(catalog, input.assignee) } : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
          });
          const text = summaryText("Created", created);
          return parent ? `${text}\nParent: ${parent.identifier}` : text;
        });
      },
    }),
  ];
}
