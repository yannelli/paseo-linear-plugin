# Linear issues

Adds **Attach Linear issue** to the message composer. Search your Linear issues, select one, and the agent receives the issue text with your prompt.

## Setup

Set `LINEAR_API_KEY` to a Linear personal API key in the environment that starts the Paseo daemon, then restart the daemon. Create the key in Linear under Settings → Security & access → Personal API keys. The plugin only reads issues, so read permission is enough. Requires Paseo 0.9.0 or newer.

## Search

- An identifier such as `ENG-123` returns that issue only. Case does not matter.
- Other text matches issue titles, without case sensitivity. Descriptions and comments are not searched.
- An empty search lists the 20 most recently updated issues. Title searches also return up to 20 issues.
- Each result shows its status and assignee.

## What the agent receives

The attachment text contains the identifier, title, URL, status, priority, assignee, project, labels, and description. The plugin takes this snapshot when you select the issue. Later changes in Linear do not update it.

## Data and permissions

The daemon subprocess sends GraphQL queries to `https://api.linear.app/graphql` with your key. The app never receives the key. Results include any issue the key can read. Paseo sends the selected snapshot to the agent provider with the message.

A rejected key, a rate limit, or a GraphQL error appears as the picker's result text. A new key takes effect only after a daemon restart.
