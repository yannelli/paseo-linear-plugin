import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import {
  type InfiniteData,
  type QueryClient,
  type QueryFilters,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useMemo } from "react";
import { createKeyQueue } from "../shared/key-queue";
import {
  authStatusRpc,
  cachedCatalogRpc,
  cachedIssueRpc,
  cachedIssuesRpc,
  catalogRpc,
  createCommentRpc,
  getIssueRpc,
  type IssueDetail,
  type IssuePage,
  type IssuePatch,
  type IssueQuery,
  listIssuesRpc,
  updateIssueRpc,
} from "../shared/linear";
import { AGENT_LABELS } from "../shared/prompts";
import { type AgentChoice, agentChoices } from "./agent-options";
import { useKeyScope } from "./key-scope";

type Scope = string | null;
const scoped = (scope: Scope) => ["linear", "scope", scope ?? "default"] as const;

export const queryKeys = {
  auth: ["linear", "auth"] as const,
  scope: scoped,
  catalog: (scope: Scope) => [...scoped(scope), "catalog"] as const,
  issues: (scope: Scope) => [...scoped(scope), "issues"] as const,
  issue: (scope: Scope, id: string) => [...scoped(scope), "issue", id] as const,
  agents: (identifier: string) => ["linear", "agents", identifier] as const,
  projects: ["linear", "projects"] as const,
  providers: ["linear", "providers"] as const,
};

// An issue opened by its key, such as ENG-123, is cached under the key, so changes find every
// cached copy of the issue by its id.
function issueCopies(scope: Scope, issueId: string): QueryFilters {
  return {
    queryKey: [...scoped(scope), "issue"],
    predicate: (query) => (query.state.data as IssueDetail | undefined)?.id === issueId,
  };
}

function updateIssueCopies(
  queries: QueryClient,
  scope: Scope,
  issueId: string,
  update: (issue: IssueDetail) => IssueDetail,
) {
  queries.setQueriesData<IssueDetail>(issueCopies(scope, issueId), (current) =>
    current ? update(current) : current,
  );
}

// Stale-while-revalidate: the daemon's last response shows while the Linear request runs.
function useSaved<T>(
  key: readonly unknown[],
  read: () => Promise<{ value: T | null }>,
  enabled: boolean,
) {
  const queries = useQueryClient();
  const fresh = queries.getQueryState(key)?.data !== undefined;
  const saved = useQuery({
    queryKey: [...key, "saved"],
    queryFn: async () => (await read()).value,
    enabled: enabled && !fresh,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 60_000,
    retry: false,
  });
  return saved.data ?? undefined;
}

export function useAuthStatus() {
  const status = useRpc(authStatusRpc);
  return useQuery({ queryKey: queryKeys.auth, queryFn: () => status({}), staleTime: 60_000 });
}

export function useCatalog(enabled = true) {
  const scope = useKeyScope();
  const catalog = useRpc(catalogRpc);
  const cached = useRpc(cachedCatalogRpc);
  const key = queryKeys.catalog(scope);
  const saved = useSaved(key, () => cached({ projectId: scope }), enabled);
  return useQuery({
    queryKey: key,
    queryFn: () => catalog({ projectId: scope }),
    placeholderData: saved,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useIssues(query: Omit<IssueQuery, "after">, enabled = true) {
  const scope = useKeyScope();
  const list = useRpc(listIssuesRpc);
  const cached = useRpc(cachedIssuesRpc);
  const key = [...queryKeys.issues(scope), query] as const;
  const saved = useSaved(key, () => cached({ ...query, after: null, projectId: scope }), enabled);
  const placeholder: InfiniteData<IssuePage, string | null> | undefined = saved
    ? { pages: [saved], pageParams: [null] }
    : undefined;
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => list({ ...query, after: pageParam, projectId: scope }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.hasNextPage ? page.endCursor : undefined),
    placeholderData: placeholder,
    enabled,
    staleTime: 30_000,
  });
}

export function useIssue(id: string | null) {
  const scope = useKeyScope();
  const get = useRpc(getIssueRpc);
  const cached = useRpc(cachedIssueRpc);
  const key = queryKeys.issue(scope, id ?? "");
  const saved = useSaved(key, () => cached({ id: id ?? "", projectId: scope }), id !== null);
  return useQuery({
    queryKey: key,
    queryFn: async () => (await get({ id: id ?? "", projectId: scope })).issue,
    placeholderData: saved?.issue,
    enabled: id !== null,
    staleTime: 15_000,
  });
}

export function useUpdateIssue(issueId: string) {
  const scope = useKeyScope();
  const update = useRpc(updateIssueRpc);
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (patch: IssuePatch) => update({ id: issueId, patch, projectId: scope }),
    onSuccess: ({ issue }) => {
      updateIssueCopies(queries, scope, issueId, (current) => ({ ...current, ...issue }));
      void queries.invalidateQueries({ queryKey: queryKeys.issues(scope) });
    },
  });
}

// Saves of one description run in order, also when the issue was closed and opened again,
// so the save of a closed editor cannot land after a newer one.
const oneDescriptionSave = createKeyQueue();

// Plain RPC calls, not a mutation, so a save that finishes after the view closes still
// updates the cache. The update returns a summary without the description, so callers
// show the new text with `show` and the save leaves the cached description alone.
export function useDescriptionSaver(issueId: string) {
  const scope = useKeyScope();
  const update = useRpc(updateIssueRpc);
  const queries = useQueryClient();
  return useMemo(() => {
    const copies = issueCopies(scope, issueId);
    return {
      show(description: string) {
        void queries.cancelQueries(copies);
        updateIssueCopies(queries, scope, issueId, (current) => ({ ...current, description }));
      },
      async save(description: string) {
        const { issue } = await oneDescriptionSave(`${scope ?? ""}:${issueId}`, () =>
          update({ id: issueId, patch: { description }, projectId: scope }),
        );
        updateIssueCopies(queries, scope, issueId, (current) => ({ ...current, ...issue }));
        void queries.invalidateQueries({ queryKey: queryKeys.issues(scope) });
      },
      reload() {
        void queries.invalidateQueries(copies);
      },
    };
  }, [scope, issueId, update, queries]);
}

export function useAddComment(issueId: string) {
  const scope = useKeyScope();
  const create = useRpc(createCommentRpc);
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => create({ issueId, body, projectId: scope }),
    onSuccess: ({ comment }) => {
      updateIssueCopies(queries, scope, issueId, (current) => ({
        ...current,
        comments: [...current.comments, comment],
      }));
    },
  });
}

export interface PaseoProjectOption {
  projectId: string;
  displayName: string;
  rootPath: string;
  kind: string;
}

export function useProjects() {
  const paseo = usePaseo();
  return useQuery({
    queryKey: queryKeys.projects,
    queryFn: async (): Promise<PaseoProjectOption[]> => {
      const { projects } = await paseo.projects.list();
      return projects
        .map((project) => ({
          projectId: project.projectId,
          displayName: project.projectDisplayName,
          rootPath: project.projectRootPath,
          kind: project.projectKind,
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
    staleTime: 60_000,
  });
}

export function useProviders() {
  const paseo = usePaseo();
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: async (): Promise<AgentChoice[]> => agentChoices(await paseo.providers.snapshot()),
    staleTime: 60_000,
    // Providers report models a few seconds after the daemon starts. Poll until one is ready.
    refetchInterval: (query) => ((query.state.data?.length ?? 0) > 0 ? false : 3_000),
  });
}

export interface LinkedAgent {
  id: string;
  title: string | null;
  status: string;
  workspaceId: string | null;
  action: string | null;
  requiresAttention: boolean;
}

export function useLinkedAgents(identifier: string | null) {
  const paseo = usePaseo();
  return useQuery({
    queryKey: queryKeys.agents(identifier ?? ""),
    enabled: identifier !== null,
    refetchInterval: 15_000,
    queryFn: async (): Promise<LinkedAgent[]> => {
      const { entries } = await paseo.agents.list({
        filter: { labels: { [AGENT_LABELS.issue]: identifier ?? "" } },
      });
      return entries.map(({ agent }) => ({
        id: agent.id,
        title: agent.title ?? null,
        status: agent.status,
        workspaceId: agent.workspaceId ?? null,
        action: agent.labels?.[AGENT_LABELS.action] ?? null,
        requiresAttention: agent.requiresAttention === true,
      }));
    },
  });
}
