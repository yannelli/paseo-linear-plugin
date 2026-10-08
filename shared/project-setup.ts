import type { InitProposal } from "./live";
import type { ProjectConfig } from "./settings";

// A setup proposal shows only fields that change; accepted fields append to the prompts.
export type ProposalField = "instructions" | "steps" | "implement" | "review";

export interface FieldDiff {
  field: ProposalField;
  label: string;
  current: string;
  proposed: string;
}

export function proposalDiffs(config: ProjectConfig, proposal: InitProposal): FieldDiff[] {
  const steps = proposal.steps.map((step) => step.trim()).filter(Boolean);
  const rows: FieldDiff[] = [
    {
      field: "instructions",
      label: "Project instructions",
      current: config.instructions.trim(),
      proposed: proposal.instructions.trim(),
    },
    {
      field: "steps",
      label: "Project steps",
      current: config.steps.join("\n"),
      proposed: steps.join("\n"),
    },
    {
      field: "implement",
      label: "Implement: append to the prompt",
      current: config.implement.mode === "default" ? "" : config.implement.text.trim(),
      proposed: proposal.implement.trim(),
    },
    {
      field: "review",
      label: "Review: append to the prompt",
      current: config.review.mode === "default" ? "" : config.review.text.trim(),
      proposed: proposal.review.trim(),
    },
  ];
  return rows.filter((row) => row.proposed && row.proposed !== row.current);
}

export function applyProposal(
  proposal: InitProposal,
  fields: ReadonlySet<ProposalField>,
): Partial<ProjectConfig> {
  const patch: Partial<ProjectConfig> = {};
  if (fields.has("instructions")) patch.instructions = proposal.instructions.trim();
  if (fields.has("steps")) patch.steps = proposal.steps.map((s) => s.trim()).filter(Boolean);
  if (fields.has("implement")) patch.implement = { mode: "append", text: proposal.implement.trim() };
  if (fields.has("review")) patch.review = { mode: "append", text: proposal.review.trim() };
  return patch;
}
