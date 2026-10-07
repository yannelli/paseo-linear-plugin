import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  authStatusRpc,
  catalogRpc,
  createCommentRpc,
  getIssueRpc,
  type IssueDetail,
  type IssuePatch,
  type IssueQuery,
  listIssuesRpc,
  updateIssueRpc,
} from "../shared/linear";
import { AGENT_LABELS } from "../shared/prompts";

export const queryKeys = {
  auth: ["linear", "auth"] as const,
  catalog: ["linear", "catalog"] as const,
  issues: ["linear", "issues"] as const,
  issue: (id: string) => ["linear", "issue", id] as const,
  agents: (identifier: string) => ["linear", "agents", identifier] as const,
  projects: ["linear", "projects"] as const,
  providers: ["linear", "providers"] as const,
};

export function useAuthStatus() {
  const status = useRpc(authStatusRpc);
  return useQuery({ queryKey: queryKeys.auth, queryFn: () => status({}), staleTime: 60_000 });
}

export function useCatalog(enabled = true) {
  const catalog = useRpc(catalogRpc);
  return useQuery({
    queryKey: queryKeys.catalog,
    queryFn: () => catalog({}),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useIssues(query: Omit<IssueQuery, "after">, enabled = true) {
  const list = useRpc(listIssuesRpc);
  return useInfiniteQuery({
    queryKey: [...queryKeys.issues, query],
    queryFn: ({ pageParam }) => list({ ...query, after: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => (page.hasNextPage ? page.endCursor : undefined),
    enabled,
    staleTime: 30_000,
  });
}

export function useIssue(id: string | null) {
  const get = useRpc(getIssueRpc);
  return useQuery({
    queryKey: queryKeys.issue(id ?? ""),
    queryFn: async () => (await get({ id: id ?? "" })).issue,
    enabled: id !== null,
    staleTime: 15_000,
  });
}

export function useUpdateIssue(issueId: string) {
  const update = useRpc(updateIssueRpc);
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (patch: IssuePatch) => update({ id: issueId, patch }),
    onSuccess: ({ issue }) => {
      queries.setQueryData<IssueDetail>(queryKeys.issue(issueId), (current) =>
        current ? { ...current, ...issue } : current,
      );
      void queries.invalidateQueries({ queryKey: queryKeys.issues });
    },
  });
}

export function useAddComment(issueId: string) {
  const create = useRpc(createCommentRpc);
  const queries = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => create({ issueId, body }),
    onSuccess: ({ comment }) => {
      queries.setQueryData<IssueDetail>(queryKeys.issue(issueId), (current) =>
        current ? { ...current, comments: [...current.comments, comment] } : current,
      );
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

export interface ProviderOption {
  provider: string;
  label: string;
  models: { id: string; label: string; isDefault: boolean }[];
}

export function useProviders() {
  const paseo = usePaseo();
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: async (): Promise<ProviderOption[]> => {
      const snapshot = await paseo.providers.snapshot();
      // App connections receive the compact catalog; full entries arrive empty there.
      const entries =
        snapshot.entries.length > 0 ? snapshot.entries : (snapshot.compactSnapshot?.entries ?? []);
      return entries
        .filter((entry) => entry.status === "ready" && entry.enabled !== false)
        .map((entry) => ({
          provider: entry.provider,
          label: entry.label ?? entry.provider,
          models: (entry.models ?? [])
            .filter((model) => model.isSelectable !== false)
            .map((model) => ({
              id: model.id,
              label: model.label,
              isDefault: model.isDefault === true,
            })),
        }))
        .filter((entry) => entry.models.length > 0);
    },
    staleTime: 60_000,
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
