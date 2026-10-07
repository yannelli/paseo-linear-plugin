import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  attachIssueCardRpc,
  authClearRpc,
  authSaveRpc,
  authStatusRpc,
  catalogRpc,
  createCommentRpc,
  createIssueRpc,
  getIssueRpc,
  ISSUE_CARD_KIND,
  listIssuesRpc,
  updateIssueRpc,
} from "../shared/linear";
import { searchIssuesRpc } from "../shared/issues";
import { type CredentialStore, keyHint } from "./credentials";
import { createLinearGraphql, LinearApiError } from "./graphql";
import { createLinearIssueSearch } from "./linear";
import { createLinearService, type LinearService } from "./queries";

export interface HandlerDependencies {
  credentials: CredentialStore;
  endpoint?: string;
}

export function registerHandlers(server: PluginServerContext, dependencies: HandlerDependencies) {
  const { credentials, endpoint } = dependencies;

  async function apiKey(): Promise<string> {
    const credential = await credentials.resolve();
    if (!credential) throw new LinearApiError("Connect Linear: add an API key in Linear settings");
    return credential.apiKey;
  }

  async function service(): Promise<LinearService> {
    return createLinearService(createLinearGraphql({ apiKey: await apiKey(), endpoint }));
  }

  server.handle(authStatusRpc, async () => {
    const credential = await credentials.resolve();
    return {
      configured: credential !== null,
      source: credential?.source ?? null,
      keyHint: credential ? keyHint(credential.apiKey) : null,
    };
  });

  server.handle(authSaveRpc, async ({ apiKey: candidate }) => {
    // Validate the key against Linear before persisting it.
    const linear = createLinearService(createLinearGraphql({ apiKey: candidate, endpoint }));
    const catalog = await linear.catalog();
    await credentials.save(candidate);
    return { viewerName: catalog.viewer.displayName, organizationName: catalog.organization.name };
  });

  server.handle(authClearRpc, async () => {
    await credentials.clear();
    return { configured: (await credentials.resolve()) !== null };
  });

  server.handle(catalogRpc, async () => (await service()).catalog());
  server.handle(listIssuesRpc, async (query) => (await service()).listIssues(query));
  server.handle(getIssueRpc, async ({ id }) => ({ issue: await (await service()).getIssue(id) }));
  server.handle(updateIssueRpc, async ({ id, patch }) => ({
    issue: await (await service()).updateIssue(id, patch),
  }));
  server.handle(createIssueRpc, async (input) => ({
    issue: await (await service()).createIssue(input),
  }));
  server.handle(createCommentRpc, async ({ issueId, body }) => ({
    comment: await (await service()).createComment(issueId, body),
  }));

  server.handle(searchIssuesRpc, async ({ query }) =>
    createLinearIssueSearch({ apiKey: await apiKey(), endpoint }).search(query),
  );

  // Only the plugin's daemon session may append timeline rows, so the client asks the server.
  server.handle(attachIssueCardRpc, async ({ agentId, card }, { paseo }) => {
    try {
      await paseo.agents.ref(agentId).timeline.append({
        type: "plugin",
        id: `linear-issue-${card.identifier}`,
        kind: ISSUE_CARD_KIND,
        version: 1,
        data: card,
      });
      return { attached: true };
    } catch (error) {
      console.error("Linear issue card was not attached", error);
      return { attached: false };
    }
  });
}
