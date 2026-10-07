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

The prompt follows the template until you edit it. **Reset prompt** restores it. Edit the templates in **Prompts**, and add project instructions in **Projects**.

## Attach an issue

Choose **Attach Linear issue** in the composer attachment menu. The agent gets the issue text with your message. This uses the default key.

## Data and permissions

Only the daemon sends requests to `https://api.linear.app/graphql`. The daemon never sends a key back to the app. Paseo sends the prompt, with the issue snapshot, to the agent provider. The daemon keeps recent Linear responses in memory for up to 24 hours, and the list shows them with **Showing saved results. Updating…** while it gets new data.
