import type { PluginServerContext } from "@getpaseo/plugin/server";
import { type InitProposal, InitProposalSchema, initStartRpc, initStatusRpc } from "../shared/live";
import { AGENT_LABELS } from "../shared/prompts";
import type { LinearSettings } from "../shared/settings";
import { createJobStore, READ_ONLY_RULES, startInternalRun } from "./agent-runs";

export function initPrompt(rootPath: string): string {
  return [
    `Set up Linear agent prompts for the repository at ${rootPath}.`,
    "",
    ...READ_ONLY_RULES,
    "",
    "Read the guidance the repository gives agents and contributors: AGENTS.md, CLAUDE.md and",
    "similar files, CONTRIBUTING, the README, package scripts or build files, CI workflows, pull",
    "request templates, commit conventions, and the test setup.",
    "",
    "Then write:",
    "- instructions: up to 12 short lines an agent must follow here: commands, conventions, limits.",
    '- steps: 3 to 8 short checks an agent runs before it finishes, such as "Run npm run check".',
    "- implement: extra guidance for implementing an issue in this repository, or an empty string.",
    "- review: extra guidance for reviewing a change in this repository, or an empty string.",
    "Use only facts you found in the repository. Do not repeat generic advice.",
    "",
    "Reply with only a JSON object in a ```json block:",
    '{"instructions":"...","steps":["..."],"implement":"...","review":"..."}',
  ].join("\n");
}

export interface InitDependencies {
  readSettings(): Promise<LinearSettings | null>;
}

export function registerInit(server: PluginServerContext, dependencies: InitDependencies) {
  const jobs = createJobStore<InitProposal>();

  server.handle(initStartRpc, async ({ projectId, rootPath }, { paseo }) => {
    // Only known Paseo projects can be set up, so the client cannot point an agent anywhere.
    const { projects } = await paseo.projects.list();
    const project = projects.find((entry) => entry.projectId === projectId);
    if (!project || project.projectRootPath !== rootPath) {
      throw new Error("That project is not on this host");
    }
    const settings = await dependencies.readSettings();
    const job = await jobs.start(null, async () =>
      startInternalRun({
        paseo,
        workspace: await paseo.workspaces.open(rootPath),
        cwd: rootPath,
        provider: settings?.live.exploreProvider || settings?.launch.provider || "",
        title: `Set up Linear prompts for ${project.projectDisplayName}`,
        prompt: initPrompt(rootPath),
        labels: { [AGENT_LABELS.init]: projectId },
        schema: InitProposalSchema,
        timeoutMs: 20 * 60_000,
      }),
    );
    return { job };
  });

  server.handle(initStatusRpc, async ({ jobId }) => {
    const record = jobs.get(jobId);
    return { job: record?.job ?? null, proposal: record?.value ?? null };
  });
}
