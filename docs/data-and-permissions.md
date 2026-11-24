# Data and permissions

Where your key lives, what goes to Linear and your agent provider, what agents can reach, and what the daemon stores.

- [Your key](#your-key)
- [Data sent out](#data-sent-out)
- [Agent access](#agent-access)
- [Stored data](#stored-data)

## Your key

Your key stays on the daemon host.

- When you save a key, the app sends it to the daemon once
- The daemon never sends a key back to the app
- The app gets only the last 4 characters, to show which key is in use
- Only the daemon sends requests to `https://api.linear.app/graphql`

## Data sent out

- **Data sent to Linear**
  - Queries for issues, teams, users, and comments, and the changes you make
  - When you start an agent with the options on, the plugin moves the issue to In Progress and assigns it to you
  - Linear errors, such as a rejected key or a rate limit, show in the panel or as a message
- **Data sent to the agent provider**
  - The prompt holds the template text and an issue snapshot: identifier, title, URL, team, status, priority, assignee, project, labels, parent, description, sub-issues, and links
  - It holds comments only when **Include comments in the prompt** is on
  - It also holds the project instructions and steps from the Projects settings
  - An attached issue sends the identifier, title, URL, status, priority, assignee, project, labels, and description
- **Setup agent**
  - It reads files in the project, and your agent provider gets what it reads

## Agent access

- **Linear tools for agents**
  - The daemon runs the `linear` MCP server on `127.0.0.1` only, and only after an agent gets it
  - When the tools are off for a project, its agents get no tools
  - Each agent started from an issue gets its own random token, and its tools reach only its issue and that issue's sub-issues
  - Edits use the Linear key of the project that loaded the issue
  - With **Give every agent the Linear tools** on, the other agents of a project share a token signed for that project, and their tools reach every issue of the project's key
  - Requests from a web page are refused
  - `agent-tools.json` beside the [key file](connect.md#default-key) keeps the port, a hash of each issue token, and the secret that signs project tokens, so agents keep their tools after a restart
  - The token itself is in the agent's Paseo config
- **Claude hooks**
  - When an **Agent guidance** switch is on for a Claude agent, the daemon writes a Claude Code plugin to `claude-hooks/` beside the key file, one folder for each issue and set of hooks
  - The Claude Code plugin holds the issue key and title and the sub-issue keys and titles
  - The agent starts with `--plugin-dir` set to that folder
  - The hooks print that text and run no other command
  - The daemon does not write hooks on Windows hosts
- **Todo sync**
  - When it is on for the agent's project, the daemon changes issue statuses in Linear with the key of the project that loaded the issue

## Stored data

- **Plugin icon**
  - The SVG is saved in the plugin settings on the daemon host
  - The app draws it as an image, which does not run scripts or load other files
  - The web app keeps the name of the built-in icon in its local storage
- **Cached results**
  - The daemon keeps up to 300 recent Linear responses in memory for up to 24 hours
  - It groups them by a hash of the key, so two keys never share results
  - The app shows saved results at once with **Showing saved results. Updating…** while it gets new data
  - An edit clears the cached lists and issues for that key
  - Saving or removing a key clears the whole cache
  - The cache is not written to disk, and a daemon restart clears it
