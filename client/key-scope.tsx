import { createContext, type ReactNode, useContext } from "react";

// The Paseo project whose Linear key the browser uses. Null means the default key.
const KeyScopeContext = createContext<string | null>(null);

export function KeyScopeProvider(props: { projectId: string | null; children: ReactNode }) {
  return (
    <KeyScopeContext.Provider value={props.projectId}>{props.children}</KeyScopeContext.Provider>
  );
}

export function useKeyScope(): string | null {
  return useContext(KeyScopeContext);
}

/** A project without its own key shares the default key, so it shares the default scope too. */
export function effectiveKeyScope(
  projectId: string | null | undefined,
  projectKeys: readonly { projectId: string }[] | undefined,
): string | null {
  if (!projectId) return null;
  return projectKeys?.some((entry) => entry.projectId === projectId) ? projectId : null;
}
