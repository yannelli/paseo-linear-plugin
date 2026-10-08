import type { PluginClientContext } from "@getpaseo/plugin/client";
import { LinearPanel, LinearScreen } from "./client/browser";
import { openPluginScreen, registerScreen } from "./client/compat";
import { gateAgentPanel } from "./client/access";
import { LivePanel } from "./client/live-panel";
import { contributeComposerPills } from "./client/pill";
import { PluginIcon } from "./client/plugin-icon";
import { ConnectionSettings } from "./client/settings-connection";
import { IconSettingsScreen } from "./client/settings-icon";
import { LiveSettings } from "./client/settings-live";
import { ProjectSettings } from "./client/settings-projects";
import { PromptSettings } from "./client/settings-prompts";
import { focusIssue, panelScope, SCREEN_SCOPE, updateBrowser } from "./client/store";
import { IssueCardRow } from "./client/timeline-card";
import { issueAttachments } from "./shared/issues";
import { ISSUE_CARD_KIND, IssueCardSchema, LINEAR_IDENTIFIER } from "./shared/linear";

const SCREEN_ID = "linear";
const PANEL_ID = "issues";
const LIVE_PANEL_ID = "live";

export default function contribute(client: PluginClientContext) {
  client.addAttachmentSource(issueAttachments);
  registerScreen(client, {
    id: SCREEN_ID,
    title: "Linear",
    icon: "SquareKanban",
    RowIcon: PluginIcon,
    Component: LinearScreen,
  });
  client.addWorkspacePanel({
    id: PANEL_ID,
    title: "Linear",
    icon: "SquareKanban",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: LinearPanel,
  });
  client.addSettingsScreen({
    id: "connection",
    title: "Account",
    icon: "KeyRound",
    Component: ConnectionSettings,
  });
  client.addSettingsScreen({
    id: "prompts",
    title: "Prompts",
    icon: "MessageSquare",
    Component: PromptSettings,
  });
  client.addWorkspacePanel({
    id: LIVE_PANEL_ID,
    title: "Linear Live",
    icon: "Radar",
    context: "agent",
    Component: gateAgentPanel(LivePanel),
  });
  client.addSettingsScreen({
    id: "live",
    title: "Live",
    icon: "Radar",
    Component: LiveSettings,
  });
  client.addSettingsScreen({
    id: "icon",
    title: "Icon",
    icon: "Shapes",
    Component: IconSettingsScreen,
  });
  client.addSettingsScreen({
    id: "projects",
    title: "Projects",
    icon: "FolderGit2",
    Component: ProjectSettings,
  });
  client.addCommandCenterItem({
    id: "open-issues",
    title: "Linear: Open issues",
    icon: "SquareKanban",
    keywords: ["linear", "issues", "tickets"],
    context: "global",
    onSelect(context) {
      openPluginScreen(context, SCREEN_ID);
    },
  });
  client.addCommandCenterItem({
    id: "create-issue",
    title: "Linear: Create issue",
    icon: "Plus",
    keywords: ["linear", "new", "ticket"],
    context: "global",
    onSelect(context) {
      updateBrowser(SCREEN_SCOPE, { creating: true });
      openPluginScreen(context, SCREEN_ID);
    },
  });
  client.addCommandCenterItem({
    id: "workspace-issues",
    title: "Linear: Show issues in this workspace",
    icon: "SquareKanban",
    keywords: ["linear", "panel"],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(PANEL_ID);
    },
  });
  client.addCommandCenterItem({
    id: "open-live",
    title: "Linear: Open Linear Live",
    icon: "Radar",
    keywords: ["linear", "live", "progress", "map"],
    context: "agent",
    onSelect({ openPanel }) {
      openPanel(LIVE_PANEL_ID);
    },
  });
  client.addCommandCenterItem({
    id: "setup-project",
    title: "Linear: Set up project prompts",
    icon: "Sparkles",
    keywords: ["linear", "init", "setup", "agents.md", "guidelines"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("projects");
    },
  });
  client.addCommandCenterItem({
    id: "settings",
    title: "Linear: Settings",
    icon: "Settings",
    keywords: ["linear", "api key", "prompts", "projects"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("connection");
    },
  });
  client.addSlashCommand({
    name: "linear",
    description: "Open Linear issues, or jump to one by key",
    argumentHint: "[ENG-123 or search]",
    context: "workspace",
    onSubmit({ args, workspace, openPanel }) {
      const scope = panelScope(workspace.id);
      const text = args.trim();
      if (LINEAR_IDENTIFIER.test(text)) focusIssue(scope, text.toUpperCase());
      else if (text)
        updateBrowser(scope, { query: text, issueId: null, assignee: "anyone", status: "all" });
      openPanel(PANEL_ID);
    },
  });
  client.addTimelineRenderer({
    kind: ISSUE_CARD_KIND,
    version: 1,
    schema: IssueCardSchema,
    Component: IssueCardRow,
  });
  return contributeComposerPills(client);
}
