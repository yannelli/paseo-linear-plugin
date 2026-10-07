import type { IssueDetail } from "./linear";
import type { AgentAction, LinearSettings, ProjectConfig } from "./settings";

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
  const instructions = project?.instructions.trim();
  if (instructions) sections.push(`Project instructions:\n${instructions}`);
  const steps = project?.steps.map((step) => step.trim()).filter(Boolean) ?? [];
  if (steps.length > 0) {
    sections.push(
      `Project steps:\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
    );
  }
  const extra = input.extraInstructions.trim();
  if (extra) sections.push(`Additional instructions:\n${extra}`);
  return sections.join("\n\n");
}

export function agentTitle(action: AgentAction, issue: { identifier: string; title: string }) {
  const prefix = action === "review" ? "Review" : issue.identifier;
  const title = action === "review" ? `${issue.identifier} ${issue.title}` : issue.title;
  return `${prefix}: ${title}`.slice(0, 120);
}

export const AGENT_LABELS = { issue: "linear.issue", action: "linear.action" } as const;
