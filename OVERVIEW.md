# Linear issues

Browse and edit Linear issues in Paseo, and start agents from them. Open **Linear** from the sidebar, or open the Linear panel in a workspace. Requires Paseo 0.10.0 or newer.

## Connect Linear

Paste a Linear personal API key in **Settings → Plugins → Linear → Account**. Create the key in Linear under Settings → Security & access → Personal API keys. To change issues, the key must have write access. The daemon saves the key on its host with owner-only permissions. If no key is saved, the plugin uses `LINEAR_API_KEY` from the daemon environment.

To use a different Linear key for one Paseo project, add it under **Project keys**. Workspace panels in that project use its key. The Linear screen shows a key button to switch keys.

## Browse issues

- Search titles and descriptions, or type an identifier such as `ENG-123`.
- Filter by assignee and status. Pick a team to see only its issues.
- Sort by Last updated, Newest, Priority, Due date, or Title.
- Select **Sub-issues** to nest sub-issues under their parent. The breadcrumbs above an issue show its team and parent chain.
- Change the status, priority, and assignee. Add comments, or create an issue.
- Descriptions and comments show as Markdown.
- Edit the description in place. It saves to Linear about one second after you stop typing, and the line under the editor confirms each save. Select a task list checkbox to check or uncheck it without opening the editor.
- `/linear` opens the panel. `/linear ENG-123` opens an issue.

## Start an agent

Select **Start agent** or **Start review** on an issue. The setup page shows the prompt and the composer controls for the prompt template, model, thinking level, and mode. The model picker lists providers first, and its search covers all models. Choose the project and where the agent runs: a new worktree, a pull request checkout, the issue branch, an existing agent workspace, or the current workspace or project folder. You can include comments in the prompt. For Implement, you can also move the issue to In Progress and assign it to you.

**Agent guidance** switches add instructions to the prompt: keep Linear updated, have subagents state their issue key, and hand off work to Paseo agents. Each project keeps its choices. With the first and last switches, the agent gets the plugin's Linear tools. It edits the issue description, checks off task list items, and starts one Paseo agent for each sub-issue. It posts no comments. For Claude agents, the switches also add hooks that give subagents the issue keys. In **Sub-issue agents**, choose an agent, model, and thinking level for a sub-issue. The agent you start hands that sub-issue to it. The prompt follows the template until you edit it. **Reset prompt** restores it. Edit the templates in **Prompts**, and add project instructions in **Projects**.

## Agent settings

In **Settings → Plugins → Linear → Agents**, turn the plugin's Linear tools on or off, allow or block description edits, show or hide sub-issue agents, limit how many agents one launch runs at the same time, and turn todo sync on or off. In **Projects**, a project can have its own values for these settings, the agent defaults, and todo sync.

## Linear pill

Each agent's composer has a Linear pill. On an agent started from an issue, it shows the issue status and each sub-issue with its todo progress. On agents not started from an issue, the pill searches Linear and sends an issue to the agent.

## Plugin icon

In **Settings → Plugins → Linear → Icon**, choose an SVG file or paste SVG markup. Composer pills, the Linear sidebar row, the timeline card, and the Linear screens use it. Panel tabs, the new tab menu, and Command Center take built-in icons only, so pick one of those for them. Keep the original colors, or paint the icon with the theme color, the theme accent, Linear indigo, or a custom color. **Solid** fills outline shapes. The plugin refuses SVGs with scripts, event handlers, or links to other files. The iOS and Android apps show the built-in icon in the chosen color.

## Update Linear from todos

Turn on **Update Linear from agent todos** in **Agents**, or for one project in **Projects**. After each turn, a todo that starts with a sub-issue key, such as `ENG-124: add the queue`, moves that sub-issue to In Progress, and then to Done when all its todos are done. The parent moves to In Review when every sub-issue is done, never to Done. Statuses only move forward.

## Set up project prompts

In **Projects**, select **Start** under **Set up with an agent**. An agent on the project's default model reads the repository's guidelines, scripts, and CI files and proposes project instructions, steps, and prompt additions. You accept each change before it is saved. **Open agent** shows the agent while it works. The agent is told to only read. The plugin starts Claude in Always Ask and answers the permission requests the agent raises: it allows reads and search commands in the project folder and denies the rest. Codex has no read-only mode, so it runs in its default mode, and the plugin answers only the requests Codex raises.

## Choose projects

In **Projects**, **Use Linear in** turns Linear on or off for all projects, and each project has its own switch. In a project where Linear is off, its panels show that Linear is off, its agents get no Linear pill, and the agent setup page does not offer it. Todo sync skips it.

## Attach an issue

Choose **Attach Linear issue** in the composer attachment menu. The agent gets the issue text with your message. This uses the default key.

## Data and permissions

Only the daemon sends requests to `https://api.linear.app/graphql`. The daemon never sends a key back to the app. Paseo sends the prompt, with the issue snapshot, to the agent provider. The setup agent reads project files and sends them to your agent provider. With agent guidance on, it writes Claude Code hooks with the issue keys and titles beside the key file, and it serves the Linear tools on 127.0.0.1 with a token for each agent. Each token reaches only its issue and that issue's sub-issues. With todo sync on, the daemon changes issue statuses in Linear. The daemon keeps recent Linear responses in memory for up to 24 hours, and the list shows them with **Showing saved results. Updating…** while it gets new data.
