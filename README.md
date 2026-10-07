![Linear issues in Paseo: an issue view with Start agent and Start review buttons, next to the install command](docs/images/social-preview.png)

# Linear issues for Paseo

A Paseo plugin for Linear. It adds a Linear screen and a workspace panel where you browse and edit Linear issues. From an issue, you can start an agent that implements it or reviews the work. Your Linear API key stays on the daemon host.

- Browse issues in a list next to the issue view. Search and filter the list, and change its sort order.
- Nest sub-issues under their parent. Breadcrumbs show the parent chain of an issue.
- Read descriptions and comments as Markdown.
- Change the status, priority, and assignee. Add comments and create issues.
- Start an agent or a review from an issue. Choose the prompt, agent, model, effort, project, and where the agent runs.
- Use a different Linear key for a Paseo project.
- See saved results at once while the plugin gets new data from Linear.
- Attach a Linear issue to a message in the composer.

![Linear screen with an issue list grouped by status on the left and issue ENG-123 open on the right](docs/images/browse.png)

![Agent setup page for ENG-123 with the prompt, the Prompt, Agent, Model, and Effort chips, the Project and Run in fields, and three options](docs/images/launch.png)

![Linear account settings with the default key status, the default key form, and a project key for Acme Mobile](docs/images/keys.png)

The images are illustrations with sample data. They come from `docs/graphics`; see [Graphics](#graphics).

## What you need

- Paseo 0.10.0 or newer, with **Enable plugins** turned on in **Settings → Plugins**.
- A Linear personal API key. Create one in Linear under **Settings → Security & access → Personal API keys**. To change issues, add comments, or create issues, the key must have write access.

## Install

```sh
paseo plugin add npm:@yannelli/paseo-linear-plugin
paseo plugin ls linear
```

To pin a version, add it to the source, for example `npm:@yannelli/paseo-linear-plugin@0.1.0`. To install a Git tag instead, run `paseo plugin add github:yannelli/paseo-linear-plugin --ref v0.1.0`. Plugins run trusted code with the daemon user's access.

## Connect Linear

### Default key

Open **Settings → Plugins → Linear → Account**, paste your key, and select **Connect Linear**. The Linear screen shows the same form until a key is set. The plugin checks the key with Linear before it saves it.

The daemon saves the key in `$PASEO_HOME/plugin-data/linear/credentials.json`, which is `~/.paseo/plugin-data/linear/credentials.json` by default. The file has mode `0600` and its folder has mode `0700`. A saved key takes effect at once. **Disconnect** deletes the saved key.

### Key from the environment

If no key is saved, the plugin uses `LINEAR_API_KEY` from the environment that starts the daemon:

```sh
export LINEAR_API_KEY="lin_api_..."
```

A saved key takes precedence over the environment. To change the environment key, restart the daemon with the new value.

### Project keys

A Paseo project can use a different Linear key, for example for a different Linear workspace. In the **Project keys** section of the Account settings, choose the project, paste the key, and select **Save project key**.

- The Linear panel in a workspace of that project uses the project key.
- When project keys exist, the Linear screen shows a key button in the filter row. Use it to switch between **Default key** and the project keys.
- The plugin looks for a key in this order: the project key, the saved default key, then `LINEAR_API_KEY`.
- The composer attachment always uses the default key.

## Use

### Browse issues

Open **Linear** from the sidebar, or run **Linear: Open issues** in the command center. In a workspace, run **Linear: Show issues in this workspace**, or type `/linear` in the composer. `/linear ENG-123` opens that issue, and `/linear <text>` searches.

- The search box matches issue titles and descriptions. An identifier such as `ENG-123` shows that issue only.
- Filter by assignee (**Mine**, **Everyone**, **Unassigned**), by status (**Active**, **Backlog**, **Done**, **All**), and by team.
- The list groups issues by status and loads more as you scroll.
- If you map Linear teams to a project in **Settings → Plugins → Linear → Projects**, the panel starts with the first mapped team.

### Sort

Select the sort button in the filter row. The options are **Last updated**, **Newest**, **Priority**, **Due date**, and **Title**.

### Sub-issues

Select **Sub-issues** in the filter row to nest sub-issues under their parent. A sub-issue shows under its parent when the parent is in the list, even if their statuses differ. Select the chevron to collapse or expand a parent. A collapsed parent shows how many sub-issues it hides.

The issue header shows breadcrumbs: the team, the parent chain, then the issue, for example **Engineering › ENG-120 › ENG-123**. Select a parent to open it. A long chain folds its middle into **…**; select it to show all parents.

### Read and edit an issue

- Select the status, priority, or assignee chip to change it.
- Descriptions and comments show as Markdown: headings, lists, task lists, code, quotes, tables, and links.
- Add a comment in the **Activity** section.
- The header buttons refresh the issue, copy its branch name, and open it in Linear.
- Select **New issue**, or run **Linear: Create issue**, to create an issue. Set the team, status, priority, assignee, title, and a Markdown description.

### Start an agent

Select **Start agent** or **Start review** in the issue view. The agent setup page opens in the panel or the screen. It works with or without a current workspace.

1. Edit the prompt in the prompt box if you want. The prompt follows the template and options until you edit it. Select **Reset prompt** to go back to the template.
2. Use the chips under the prompt box to set **Prompt** (Implement or Review), **Agent**, **Model**, **Effort**, and **Mode**. **Mode** shows when the agent has modes.
3. Choose the **Project**. The default is the project of the current workspace. Without a workspace, it is the last project you used for the team, then a project mapped to the team.
4. Choose where the agent runs in **Run in**:
   - **New worktree** on the issue branch.
   - **Check out PR #N** for a review, when the issue links a GitHub pull request.
   - **Check out issue branch** for a review.
   - **Existing agent workspace** or **Implementation workspace**, when an agent already works on the issue.
   - **This workspace**, or **Project folder** when you are not in a workspace of that project.

   The worktree and checkout options show only for a Git project.
5. Set the options: **Include comments in the prompt**, **Move the issue to In Progress**, and **Assign the issue to me**. The last two show only for Implement, and only when they would change the issue.
6. Select **Start agent** or **Start review**.

The plugin starts the agent and then updates Linear. If the Linear update fails, the agent keeps running and a message shows the error. The agent's timeline gets a card that links to the issue. The issue view lists the agents started from it under **Agents on this issue**.

Set the default model, where agents run, the default options, and the Implement and Review templates in **Settings → Plugins → Linear → Prompts**. In **Projects**, add instructions and steps for a project, or append to or replace a template for that project.

### Attach an issue to a message

In the composer, open the attachment menu and choose **Attach Linear issue**. Type an identifier such as `ENG-123`, or words from a title. An empty search lists the 20 most recently updated issues. The agent gets the issue text with your message. The plugin takes this snapshot when you select the issue.

## Data and permissions

- **Your key stays on the daemon host.** When you save a key, the app sends it to the daemon once. The daemon never sends a key back to the app. The app gets only the last four characters, to show which key is in use. Only the daemon sends requests to `https://api.linear.app/graphql`.
- **Data sent to Linear:** queries for issues, teams, users, and comments, and the changes you make. When you start an agent with the options on, the plugin moves the issue to In Progress and assigns it to you.
- **Data sent to the agent provider:** the prompt. It holds the template text and an issue snapshot: identifier, title, URL, team, status, priority, assignee, project, labels, parent, description, sub-issues, and links. It holds comments only when **Include comments in the prompt** is on. It also holds the project instructions and steps from the Projects settings. An attached issue sends the identifier, title, URL, status, priority, assignee, project, labels, and description.
- **Cached results:** the daemon keeps up to 300 recent Linear responses in memory for up to 24 hours. It groups them by a hash of the key, so two keys never share results. The app shows saved results at once with **Showing saved results. Updating…** while it gets new data. An edit clears the cached lists and issues for that key. Saving or removing a key clears the whole cache. The cache is not written to disk, and a daemon restart clears it.

Linear errors, such as a rejected key or a rate limit, show in the panel or as a message.

## How it works

| File | Runtime | Role |
| --- | --- | --- |
| `index.client.tsx` | App | Registers the Linear screen, the workspace panel, the Account, Prompts, and Projects settings, the command center items, the `/linear` command, the timeline card, and the composer attachment |
| `index.server.ts` | Daemon | Registers the settings and the RPC handlers |
| `client/browser.tsx` | App | Screen and panel: picks the key, then shows the list, the issue, or the agent setup page |
| `client/issue-list.tsx`, `client/issue-row.tsx`, `client/issue-tree.ts` | App | Search, filters, sort, rows, status groups, and sub-issue nesting |
| `client/issue-detail.tsx`, `client/issue-sections.tsx`, `client/breadcrumbs.tsx` | App | Issue view: properties, breadcrumbs, sub-issues, links, agents, and comments |
| `client/markdown.tsx` | App | Renders Markdown |
| `client/launch.tsx`, `client/launch-fields.tsx`, `client/launch-choices.ts`, `client/launch-plan.ts`, `client/agent-options.ts` | App | Agent setup page, Run in options, and agent start |
| `client/create-issue.tsx`, `client/pickers.tsx` | App | New issue form and option pickers |
| `client/connect.tsx`, `client/settings-*.tsx` | App | Key form and settings screens |
| `client/queries.ts`, `client/store.ts`, `client/key-scope.tsx` | App | Data hooks with saved results, browser state, and the key in use |
| `client/compat.ts` | App | Registers the screen on Paseo 0.10 and on later releases |
| `client/timeline-card.tsx`, `client/ui.tsx`, `client/glyphs.tsx` | App | Timeline card, shared controls, and icons |
| `shared/linear.ts` | Both | RPC contracts and issue schemas |
| `shared/issues.ts` | Both | The `issues.search` RPC and the composer attachment source |
| `shared/settings.ts` | Both | Settings schema: templates, agent defaults, and project settings |
| `shared/prompts.ts` | Both | Default templates and the issue snapshot |
| `shared/markdown.ts` | Both | Markdown parser |
| `server/handlers.ts` | Daemon | RPC handlers, key lookup, and cache use |
| `server/credentials.ts` | Daemon | Key file and key order |
| `server/cache.ts` | Daemon | Response cache in memory |
| `server/graphql.ts`, `server/queries.ts` | Daemon | Linear GraphQL client, queries, and changes |
| `server/linear.ts` | Daemon | Search and snapshot text for the composer attachment |

The client bundle holds no credentials and makes no calls to Linear.

## Development

Use Node.js 24.

```sh
git clone https://github.com/yannelli/paseo-linear-plugin.git
cd paseo-linear-plugin
npm ci
npm run check
paseo plugin add "$PWD"
```

After you edit the source, run `paseo plugin reload linear`. `npm run check` runs the typecheck and the tests. The tests cover the Linear client, the key file, the cache, the handlers, sub-issue nesting, the Markdown parser, the agent options, and the release scripts. They use a local GraphQL server and do not call Linear.

## Graphics

`docs/graphics/scene.html` and `scene.css` define the README images, the GitHub social preview, and the icon. Render them into `docs/images` with Playwright and Chromium:

```sh
node docs/graphics/render.mjs
```

The script finds Playwright locally or in the global npm root. Set `PLAYWRIGHT_MODULE` to its entry file to choose another copy. It stops if the fonts do not load, if content leaves the frame or is cut off, or if an image is 900 KB or larger. The fonts are Instrument Sans and JetBrains Mono under the [SIL Open Font License](docs/graphics/fonts/OFL.txt). The line icons follow [Lucide](https://lucide.dev), which uses the ISC License. The mark is original and is not the Linear logo.

## Releases

GitHub Actions runs the checks and publishes a release on qualifying pushes to `main`. The first release is `v0.1.0`. The workflow updates `package.json` and `package-lock.json`, pushes an annotated tag, and publishes release notes. It then publishes [`@yannelli/paseo-linear-plugin`](https://www.npmjs.com/package/@yannelli/paseo-linear-plugin) to npm through trusted publishing (OIDC), with no npm token. See [npm publishing](docs/npm-publishing.md) for the first-publish steps.

Use Conventional Commits in commits and squash-merge titles:

| Commit | Version change |
| --- | --- |
| `fix:`, `perf:`, `revert:` | Patch |
| `feat:` | Minor |
| `!` after the type or scope, or a `BREAKING CHANGE:` footer | Major, including before 1.0 |
| `docs:`, `chore:`, `ci:`, and other types without a breaking marker | No release |

The highest change since the last release sets the next version. For example, `fix: trim identifier queries` changes `0.1.0` to `0.1.1`, and `feat: filter by project` changes it to `0.2.0`.

Run `npm run release:dry-run` from a clean `main` checkout with all tags fetched to preview the next release. To complete a GitHub or npm publication that stopped after its tag was pushed, run the **Release** workflow again.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, checks, commit message rules, and how releases work.

## License

Apache License 2.0. The plugin started as the Linear example plugin (`plugin-examples/linear`) in [getpaseo/paseo](https://github.com/getpaseo/paseo). See [NOTICE](NOTICE).
