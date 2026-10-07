import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  attachIssueCardRpc,
  authClearRpc,
  authSaveRpc,
  authStatusRpc,
  cachedCatalogRpc,
  cachedIssueRpc,
  cachedIssuesRpc,
  catalogRpc,
  createCommentRpc,
  createIssueRpc,
  getIssueRpc,
  ISSUE_CARD_KIND,
  type IssueQuery,
  listIssuesRpc,
  updateIssueRpc,
} from "../shared/linear";
import { searchIssuesRpc } from "../shared/issues";
import { cacheKey, createResponseCache, keyFingerprint, type ResponseCache } from "./cache";
import { type CredentialStore, keyHint } from "./credentials";
import { createLinearGraphql, LinearApiError } from "./graphql";
import { createLinearIssueSearch } from "./linear";
import { createLinearService, type LinearService } from "./queries";

export interface HandlerDependencies {
  credentials: CredentialStore;
  endpoint?: string;
  cache?: ResponseCache;
}

type ProjectId = string | null | undefined;

// The cache key ignores the key scope and cursor fields that do not change the response.
function listKey(query: IssueQuery) {
  const { teamId, assignee, status, query: text, sort = "updated", after } = query;
  return { teamId, assignee, status, query: text.trim(), sort, after };
}

export function registerHandlers(server: PluginServerContext, dependencies: HandlerDependencies) {
  const { credentials, endpoint } = dependencies;
  const cache =
    dependencies.cache ?? createResponseCache({ maxEntries: 300, maxAgeMs: 24 * 60 * 60 * 1000 });

  async function apiKey(projectId?: ProjectId): Promise<string> {
    const credential = await credentials.resolve(projectId);
    if (!credential) throw new LinearApiError("Connect Linear: add an API key in Linear settings");
    return credential.apiKey;
  }

  async function connect(projectId: ProjectId) {
    const key = await apiKey(projectId);
    return {
      linear: createLinearService(createLinearGraphql({ apiKey: key, endpoint })),
      fingerprint: keyFingerprint(key),
    };
  }

  /** Returns the cached response for a key scope without calling Linear. */
  async function readCache<T>(projectId: ProjectId, kind: string, params: unknown) {
    const credential = await credentials.resolve(projectId);
    const entry = credential
      ? cache.get<T>(cacheKey(keyFingerprint(credential.apiKey), kind, params))
      : null;
    return entry
      ? { value: entry.value, fetchedAt: new Date(entry.fetchedAt).toISOString() }
      : { value: null, fetchedAt: null };
  }

  async function fetchAndStore<T>(
    projectId: ProjectId,
    kind: string,
    params: unknown,
    load: (linear: LinearService) => Promise<T>,
  ): Promise<T> {
    const { linear, fingerprint } = await connect(projectId);
    const value = await load(linear);
    cache.set(cacheKey(fingerprint, kind, params), value);
    return value;
  }

  // Edits change list order and issue details, so every list and issue entry for the key goes.
  async function mutate<T>(projectId: ProjectId, run: (linear: LinearService) => Promise<T>) {
    const { linear, fingerprint } = await connect(projectId);
    try {
      return await run(linear);
    } finally {
      cache.drop(`${fingerprint}:issues:`);
      cache.drop(`${fingerprint}:issue:`);
    }
  }

  server.handle(authStatusRpc, async ({ projectId }) => {
    const credential = await credentials.resolve(projectId);
    const projectKeys = await credentials.projectKeys();
    return {
      configured: credential !== null,
      source: credential?.source ?? null,
      keyHint: credential ? keyHint(credential.apiKey) : null,
      projectKeys: projectKeys.map((entry) => ({
        projectId: entry.projectId,
        keyHint: keyHint(entry.apiKey),
      })),
    };
  });

  server.handle(authSaveRpc, async ({ apiKey: candidate, projectId }) => {
    // Validate the key against Linear before persisting it.
    const linear = createLinearService(createLinearGraphql({ apiKey: candidate, endpoint }));
    const catalog = await linear.catalog();
    await credentials.save(candidate, projectId);
    cache.clear();
    return { viewerName: catalog.viewer.displayName, organizationName: catalog.organization.name };
  });

  server.handle(authClearRpc, async ({ projectId }) => {
    await credentials.clear(projectId);
    cache.clear();
    return { configured: (await credentials.resolve(projectId)) !== null };
  });

  server.handle(catalogRpc, async ({ projectId }) =>
    fetchAndStore(projectId, "catalog", null, (linear) => linear.catalog()),
  );
  server.handle(listIssuesRpc, async ({ projectId, ...query }) =>
    fetchAndStore(projectId, "issues", listKey(query), (linear) => linear.listIssues(query)),
  );
  server.handle(getIssueRpc, async ({ id, projectId }) =>
    fetchAndStore(projectId, "issue", id, async (linear) => ({ issue: await linear.getIssue(id) })),
  );

  server.handle(cachedCatalogRpc, async ({ projectId }) => readCache(projectId, "catalog", null));
  server.handle(cachedIssuesRpc, async ({ projectId, ...query }) =>
    readCache(projectId, "issues", listKey(query)),
  );
  server.handle(cachedIssueRpc, async ({ id, projectId }) => readCache(projectId, "issue", id));

  server.handle(updateIssueRpc, async ({ id, patch, projectId }) => ({
    issue: await mutate(projectId, (linear) => linear.updateIssue(id, patch)),
  }));
  server.handle(createIssueRpc, async ({ projectId, linearProjectId, ...input }) => ({
    issue: await mutate(projectId, (linear) =>
      linear.createIssue(
        linearProjectId === undefined ? input : { ...input, projectId: linearProjectId },
      ),
    ),
  }));
  server.handle(createCommentRpc, async ({ issueId, body, projectId }) => ({
    comment: await mutate(projectId, (linear) => linear.createComment(issueId, body)),
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
