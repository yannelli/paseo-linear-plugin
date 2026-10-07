import { useCallback, useSyncExternalStore } from "react";
import type { AssigneeFilter, StatusFilter } from "../shared/linear";

// In-memory navigation state per browser scope ("screen" or a workspace panel). Paseo 0.10
// screens take no params, so commands write the focused issue here before opening a surface.
export interface BrowserState {
  issueId: string | null;
  teamId: string | null;
  assignee: AssigneeFilter;
  status: StatusFilter;
  query: string;
  creating: boolean;
}

export const SCREEN_SCOPE = "screen";
export const panelScope = (workspaceId: string) => `panel:${workspaceId}`;

const INITIAL: BrowserState = {
  issueId: null,
  teamId: null,
  assignee: "me",
  status: "active",
  query: "",
  creating: false,
};
const states = new Map<string, BrowserState>();
const listeners = new Set<() => void>();

function read(scope: string): BrowserState {
  return states.get(scope) ?? INITIAL;
}

export function updateBrowser(scope: string, patch: Partial<BrowserState>): void {
  states.set(scope, { ...read(scope), ...patch });
  for (const listener of listeners) listener();
}

export function focusIssue(scope: string, issueId: string | null): void {
  updateBrowser(scope, { issueId, creating: false });
}

export function useBrowserState(scope: string) {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => read(scope),
    () => read(scope),
  );
  const update = useCallback(
    (patch: Partial<BrowserState>) => updateBrowser(scope, patch),
    [scope],
  );
  return [state, update] as const;
}
