# How it works

What each source file does, and whether it runs in the app or on the daemon.

## Source files

| File | Runtime | Role |
| --- | --- | --- |
| `index.client.tsx` | App | Registers the Linear screen, the workspace panel, the Account, Prompts, Agents, Icon, and Projects settings, the command center items, the `/linear` command, the timeline card, the composer attachment, and the Linear pill |
| `index.server.ts` | Daemon | Registers the settings, the RPC handlers, and the todo sync hook |
| `client/browser.tsx` | App | Screen and panel: picks the key, then shows the list, the issue, or the agent setup page |
| `client/issue-list.tsx`, `client/issue-row.tsx`, `client/issue-tree.ts` | App | Search, filters, sort, rows, status groups, and sub-issue nesting |
| `client/issue-detail.tsx`, `client/issue-sections.tsx`, `client/breadcrumbs.tsx` | App | Issue view: properties, breadcrumbs, sub-issues, links, agents, and comments |
| `client/issue-description.tsx`, `client/autosave.ts` | App | Description editor, task list checkboxes, and debounced saves |
| `client/markdown.tsx` | App | Renders Markdown |
| `client/launch.tsx`, `client/launch-fields.tsx`, `client/launch-guidance.tsx`, `client/launch-assignments.tsx`, `client/launch-choices.ts`, `client/launch-plan.ts`, `client/agent-options.ts` | App | Agent setup page, Run in options, agent guidance, sub-issue agents, and agent start |
| `client/model-browser.tsx`, `client/provider-icon.tsx` | App | Model picker and provider icons |
| `client/plugin-icon.tsx`, `client/settings-icon.tsx`, `shared/custom-icon.ts` | App, Both | The plugin icon (the mark or your SVG), its settings screen, and the SVG checks, colors, and fill |
| `client/create-issue.tsx`, `client/pickers.tsx` | App | New issue form and option pickers |
| `client/connect.tsx`, `client/settings-*.tsx` | App | Key form and settings screens, with the Agents screen and the project's own values in `settings-agents.tsx` and `settings-overrides.tsx` |
| `client/queries.ts`, `client/store.ts`, `client/key-scope.tsx` | App | Data hooks with saved results, browser state, and the key in use |
| `client/compat.ts` | App | Registers the screen and its sidebar row, and finds the SVG icons of Paseo 0.13 and newer |
| `client/timeline-card.tsx`, `client/ui.tsx`, `client/glyphs.tsx` | App | Timeline card, shared controls, and icons |
| `client/web.ts` | App | File picker and local storage on the web |
| `client/pill.tsx` | App | Linear pill in each agent's composer |
| `client/project-init.tsx` | App | Project setup proposal in the Projects settings |
| `shared/linear.ts` | Both | RPC contracts and issue schemas |
| `shared/issues.ts` | Both | The `issues.search` RPC and the composer attachment source |
| `shared/settings.ts` | Both | Settings schema: templates, agent defaults, Linear tools, and project settings with their own values |
| `shared/prompts.ts` | Both | Default templates and the issue snapshot |
| `shared/markdown.ts` | Both | Markdown parser and task list toggle |
| `shared/key-queue.ts` | Both | Runs saves, edits, syncs, and agent starts for one key at a time |
| `shared/agent-hooks.ts`, `server/agent-hooks.ts` | Both, Daemon | Claude Code hooks for agent guidance, and the plugin folder the daemon writes |
| `shared/agent-tools.ts`, `server/agent-tools.ts`, `server/mcp-http.ts` | Both, Daemon | The `linear` MCP server: its tools, tokens, and HTTP transport |
| `server/issue-tools.ts`, `server/project-tools.ts` | Daemon | The Linear tools of the MCP server, and the hook that gives them to every agent of a project |
| `shared/todo-sync.ts`, `shared/project-setup.ts` | Both | Todo keys, status moves, the sync and setup RPCs, and setup proposals |
| `server/handlers.ts` | Daemon | RPC handlers, key lookup, and cache use |
| `server/credentials.ts` | Daemon | Key file and key order |
| `server/cache.ts` | Daemon | Response cache in memory |
| `server/graphql.ts`, `server/queries.ts` | Daemon | Linear GraphQL client, queries, and changes |
| `server/linear.ts` | Daemon | Search and snapshot text for the composer attachment |
| `server/agent-runs.ts`, `server/json-file.ts` | Daemon | The read-only setup agent run and its permission answers, and JSON files on disk |
| `server/sync.ts`, `server/init.ts` | Daemon | Todo sync after each turn, and project setup runs |

## Credentials

The client bundle holds no credentials and makes no calls to Linear.
