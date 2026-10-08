import { type PluginAgentPanelProps, useSettings, useWorkspace } from "@getpaseo/plugin/client";
import { type ComponentType, type ReactNode, useEffect } from "react";
import { linearSettings, type ProjectAccess, projectEnabled } from "../shared/settings";
import { PluginIcon } from "./plugin-icon";
import { EmptyState, type Theme } from "./ui";

// Composer pills live outside React, so components that read settings share the project
// switches here, and the pill code listens for changes.
let current: ProjectAccess | null = null;
const listeners = new Set<(access: ProjectAccess) => void>();

export function publishAccess(access: ProjectAccess): void {
  if (current && JSON.stringify(current) === JSON.stringify(access)) return;
  current = access;
  for (const listener of listeners) listener(access);
}

export function currentAccess(): ProjectAccess | null {
  return current;
}

export function onAccessChange(listener: (access: ProjectAccess) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Null while settings load or when the project is unknown, so callers can wait. */
export function useProjectEnabled(projectId: string | null | undefined): boolean | null {
  const settings = useSettings(linearSettings);
  const access = settings.status === "ready" ? settings.values.access : null;
  useEffect(() => {
    if (access) publishAccess(access);
  }, [access]);
  if (!access || projectId === undefined) return null;
  return projectEnabled(access, projectId);
}

export function ProjectGate(props: {
  theme: Theme;
  projectId: string | null | undefined;
  children: ReactNode;
}) {
  const enabled = useProjectEnabled(props.projectId);
  if (enabled !== false) return <>{props.children}</>;
  return (
    <EmptyState
      theme={props.theme}
      icon={PluginIcon}
      title="Linear is off for this project"
      detail="Turn it on in Linear settings, under Projects."
    />
  );
}

const selectProjectId = (workspace: { projectId: string }) => workspace.projectId;

/** Wraps an agent panel so it shows the off state in projects where Linear is off. */
export function gateAgentPanel(Panel: ComponentType<PluginAgentPanelProps>) {
  return function GatedAgentPanel(props: PluginAgentPanelProps) {
    const projectId = useWorkspace(props.workspaceId, selectProjectId);
    return (
      <ProjectGate theme={props.theme} projectId={projectId}>
        <Panel {...props} />
      </ProjectGate>
    );
  };
}
