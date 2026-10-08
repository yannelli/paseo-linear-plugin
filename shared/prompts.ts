import { TOOLS_SERVER } from "./agent-tools";
import type { IssueDetail } from "./linear";
import type { AgentAction, Guidance, LinearSettings, ProjectConfig } from "./settings";
import { todoConventionLine } from "./todo-sync";

export const DEFAULT_TEMPLATES: Record<AgentAction, string> = {
  implement: [
    "You are working on Linear issue {{identifier}}: {{title}}",
    "",
    "{{issue}}",
    "",
    "Implement what this issue asks for on branch {{branch}}.",
    "1. Read the relevant code and confirm the expected behavior before you edit.",
    "2. Make the smallest complete change. Add or update tests where the project has them.",
    "3. Run the project's checks and fix what fails.",
    "4. Finish with a summary: what changed, how you verified it, and what is still open.",
  ].join("\n"),
  review: [
    "Review the work for Linear issue {{identifier}}: {{title}}",
    "",
    "{{issue}}",
    "",
    "Compare the current changes with the issue. Use the linked pull request if there is one,",
    "otherwise the diff of this branch against its base branch.",
    "Report:",
    "- Each requirement: met, partly met, or missing.",
    "- Bugs, regressions, and risky changes, with file and line references.",
    "- Missing or weak tests.",
    "Do not edit files unless you are asked to.",
  ].join("\n"),
};

export const TEMPLATE_VARIABLES = [
  { name: "identifier", description: "Issue key, such as ENG-123" },
  { name: "title", description: "Issue title" },
  { name: "url", description: "Link to the issue in Linear" },
  { name: "branch", description: "Branch name Linear suggests for the issue" },
  { name: "issue", description: "Full issue snapshot: fields, description, sub-issues, comments" },
] as const;

export const ACTION_LABELS: Record<AgentAction, { title: string; verb: string; icon: string }> = {
  implement: { title: "Implement", verb: "Start agent", icon: "Play" },
  review: { title: "Review", verb: "Start review", icon: "ScanSearch" },
};

export interface IssueSnapshotOptions {
  includeComments: boolean;
}

export function issueSnapshot(issue: IssueDetail, options: IssueSnapshotOptions): string {
  const lines = [
    `Linear issue ${issue.identifier}: ${issue.title}`,
    `URL: ${issue.url}`,
    `Team: ${issue.team.name}`,
    `Status: ${issue.state.name}`,
    `Priority: ${issue.priorityLabel}`,
  ];
  if (issue.assignee) lines.push(`Assignee: ${issue.assignee.displayName}`);
  if (issue.project) lines.push(`Project: ${issue.project.name}`);
  if (issue.labels.length > 0) {
    lines.push(`Labels: ${issue.labels.map((label) => label.name).join(", ")}`);
  }
  if (issue.parent) lines.push(`Parent: ${issue.parent.identifier} ${issue.parent.title}`);
  lines.push("", "Description:", issue.description?.trim() || "No description.");
  if (issue.children.length > 0) {
    lines.push("", "Sub-issues:");
    for (const child of issue.children) {
      lines.push(`- ${child.identifier} [${child.state.name}] ${child.title}`);
    }
  }
  const links = issue.attachments.filter((attachment) => attachment.url);
  if (links.length > 0) {
    lines.push("", "Links:");
    for (const link of links) lines.push(`- ${link.title}: ${link.url}`);
  }
  if (options.includeComments && issue.comments.length > 0) {
    lines.push("", "Comments (oldest first):");
    for (const comment of issue.comments) {
      const author = comment.user?.displayName ?? "Unknown";
      lines.push(`- ${author} (${comment.createdAt.slice(0, 10)}): ${comment.body.trim()}`);
    }
  }
  return lines.join("\n");
}

export function baseTemplate(settings: LinearSettings, action: AgentAction): string {
  const custom = settings.templates[action].trim();
  return custom || DEFAULT_TEMPLATES[action];
}

export function actionTemplate(
  settings: LinearSettings,
  project: ProjectConfig | null,
  action: AgentAction,
): string {
  const base = baseTemplate(settings, action);
  const override = project?.[action];
  if (!override || override.mode === "default" || !override.text.trim()) return base;
  if (override.mode === "replace") return override.text.trim();
  return `${base}\n\n${override.text.trim()}`;
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, name: string) =>
    values[name] !== undefined ? values[name] : match,
  );
}

export interface ComposePromptInput {
  action: AgentAction;
  issue: IssueDetail;
  settings: LinearSettings;
  project: ProjectConfig | null;
  includeComments: boolean;
  extraInstructions: string;
  /** Launch options that add instructions; the project's saved ones when omitted. */
  guidance?: Guidance;
}

/** The instructions each guidance option adds, in prompt order. */
export function guidanceSections(issue: IssueDetail, guidance: Guidance): string[] {
  const sections: string[] = [];
  const example = issue.children[0]?.identifier ?? issue.identifier;
  if (guidance.updateLinear) {
    sections.push(
      [
        "Keep Linear current while you work:",
        `- Start each todo with the issue key it is for, such as "${example}: add the form".`,
        "- Mark a todo in progress when you start it and completed when it is done. Linear Live moves the issue from these todos.",
        `- Use the ${TOOLS_SERVER} MCP tools: read_issue shows an issue, and edit_issue changes its description.`,
        "- When you finish a task list item in a description, check it off: replace `- [ ] item` with `- [x] item`.",
        "- When the plan changes, update the description. Do not post comments.",
      ].join("\n"),
    );
  }
  if (guidance.subagentKeys) {
    sections.push(
      [
        "When you start a subagent:",
        `- Begin its description and its prompt with the Linear issue key it works on, such as "${example}: review the form".`,
        "- Tell it to put that key in the first line of its reply, and to state the new key if its work moves to another issue.",
      ].join("\n"),
    );
  }
  if (guidance.paseoSubagents) {
    sections.push(
      [
        "Hand off work to Paseo agents, not to your built-in subagent tool:",
        `- Start each one with the ${TOOLS_SERVER} start_agent tool, one agent for each sub-issue. It runs on your provider and model.`,
        "- Set its thinking to fit the task: low for search and reading, medium for routine edits, high for design, debugging, and review.",
        `- Start its title with the issue key, such as "${example}: write the tests". Give the full task in its prompt, because it does not see your conversation.`,
        "- Call wait_agent for each agent and read its result before you continue.",
      ].join("\n"),
    );
  }
  return sections;
}

export function composePrompt(input: ComposePromptInput): string {
  const { issue, project } = input;
  const template = actionTemplate(input.settings, project, input.action);
  const snapshot = issueSnapshot(issue, { includeComments: input.includeComments });
  const sections = [
    renderTemplate(template, {
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      branch: issue.branchName,
      issue: snapshot,
    }),
  ];
  // A template that drops {{issue}} still gets the snapshot so the agent never works blind.
  if (!/\{\{\s*issue\s*\}\}/.test(template)) sections.push(snapshot);
  const convention = input.action === "implement" ? todoConventionLine(issue.children) : null;
  if (convention) sections.push(convention);
  const instructions = project?.instructions.trim();
  if (instructions) sections.push(`Project instructions:\n${instructions}`);
  const steps = project?.steps.map((step) => step.trim()).filter(Boolean) ?? [];
  if (steps.length > 0) {
    sections.push(
      `Project steps:\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
    );
  }
  const guidance = input.guidance ?? project?.guidance;
  if (guidance) sections.push(...guidanceSections(issue, guidance));
  const extra = input.extraInstructions.trim();
  if (extra) sections.push(`Additional instructions:\n${extra}`);
  return sections.join("\n\n");
}

export function agentTitle(action: AgentAction, issue: { identifier: string; title: string }) {
  const prefix = action === "review" ? "Review" : issue.identifier;
  const title = action === "review" ? `${issue.identifier} ${issue.title}` : issue.title;
  return `${prefix}: ${title}`.slice(0, 120);
}

export const AGENT_LABELS = {
  issue: "linear.issue",
  action: "linear.action",
  /** The Paseo project whose Linear key loaded the issue. */
  project: "linear.project",
  explore: "linear.explore",
  init: "linear.init",
  /** The grant of the agent's Linear MCP tools, so a tool call can find its agent. */
  tools: "linear.tools",
  /** The grant whose start_agent call made this agent. */
  startedBy: "linear.started-by",
} as const;

/** Agents the plugin starts for itself: explore and project setup. */
export function isInternalAgent(labels: Readonly<Record<string, string>> | undefined): boolean {
  return Boolean(labels?.[AGENT_LABELS.explore] || labels?.[AGENT_LABELS.init]);
}
