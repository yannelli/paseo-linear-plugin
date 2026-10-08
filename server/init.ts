import type { PluginServerContext } from "@getpaseo/plugin/server";
import { knowledgeLines, type ProjectKnowledge } from "../shared/knowledge";
import { type InitProposal, InitProposalSchema, initStartRpc, initStatusRpc } from "../shared/live";
import { AGENT_LABELS } from "../shared/prompts";
import type { LinearSettings } from "../shared/settings";
import { createJobStore, READ_ONLY_RULES, startInternalRun } from "./agent-runs";
import type { KnowledgeService } from "./knowledge";

export function initPrompt(rootPath: string, knowledge: ProjectKnowledge | null = null): string {
  const map = knowledgeLines(knowledge);
  const areas = knowledge?.areas.length ? knowledge.areas : null;
  return [
    `Set up Linear agent prompts for the repository at ${rootPath}.`,
    "",
    ...READ_ONLY_RULES,
    "",
    ...(map.length > 0 ? [...map, ""] : []),
    "Read the guidance the repository gives agents and contributors: AGENTS.md, CLAUDE.md and",
    "similar files, CONTRIBUTING, the README, package scripts or build files, CI workflows, pull",
    "request templates, commit conventions, and the test setup.",
    "",
    "Then write:",
    "- instructions: up to 12 short lines an agent must follow here: commands, conventions, limits.",
    '- steps: 3 to 8 short checks an agent runs before it finishes, such as "Run npm run check".',
    "- implement: extra guidance for implementing an issue in this repository, or an empty string.",
    "- review: extra guidance for reviewing a change in this repository, or an empty string.",
    "- summary: one line on what the project is and does.",
    areas
      ? "- areas: for each area in the project map, one line on what it holds, keyed by its path."
      : "- areas: an empty list.",
    "Use only facts you found in the repository. Do not repeat generic advice.",
    "",
    "Reply with only a JSON object in a ```json block:",
    '{"instructions":"...","steps":["..."],"implement":"...","review":"...","summary":"...",',
    ` "areas":[${areas ? `{"path":"${areas[0]?.path ?? ""}","summary":"..."}` : ""}]}`,
  ].join("\n");
}

export interface InitDependencies {
  readSettings(): Promise<LinearSettings | null>;
  knowledge: KnowledgeService;
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
    const { knowledge } = dependencies;
    const job = await jobs.start(null, async () => {
      // Setup always inspects again, so the agent starts from the current files.
      const known = await knowledge.inspect({ projectId, rootPath }).catch((error: unknown) => {
        console.error(`Linear could not inspect project ${projectId}`, error);
        return null;
      });
      const run = await startInternalRun({
        paseo,
        workspace: await paseo.workspaces.open(rootPath),
        cwd: rootPath,
        provider: settings?.live.exploreProvider || settings?.launch.provider || "",
        effort: settings?.live.exploreProvider ? settings.live.exploreEffort : "",
        title: `Set up Linear prompts for ${project.projectDisplayName}`,
        prompt: initPrompt(rootPath, known),
        labels: { [AGENT_LABELS.init]: projectId },
        schema: InitProposalSchema,
        timeoutMs: 20 * 60_000,
      });
      const result = run.result.then(async (proposal) => {
        await knowledge.annotate(projectId, proposal).catch((error: unknown) =>
          console.error(`Linear could not save what setup learned about ${projectId}`, error),
        );
        return proposal;
      });
      return { agentId: run.agentId, result };
    });
    return { job };
  });

  server.handle(initStatusRpc, async ({ jobId }) => {
    const record = jobs.get(jobId);
    return { job: record?.job ?? null, proposal: record?.value ?? null };
  });
}
