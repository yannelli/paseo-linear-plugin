import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { authClearRpc } from "../shared/linear";
import { ApiKeyForm } from "./connect";
import { useAuthStatus, useProjects } from "./queries";
import { errorMessage, type Theme } from "./ui";

const FORM_STYLE = { gap: 10, paddingTop: 8 } as const;

// Keys for single Paseo projects. Workspaces in such a project use its key instead of the default.
export function ProjectKeysSection({ theme }: { theme: Theme }) {
  const auth = useAuthStatus();
  const projects = useProjects();
  const toast = useToast();
  const queries = useQueryClient();
  const clear = useRpc(authClearRpc);
  const saved = auth.data?.projectKeys ?? [];
  const names = useMemo(
    () => new Map(projects.data?.map((project) => [project.projectId, project.displayName])),
    [projects.data],
  );
  const options = useMemo(
    () =>
      (projects.data ?? []).map((project) => ({
        value: project.projectId,
        label: saved.some((entry) => entry.projectId === project.projectId)
          ? `${project.displayName} (has a key)`
          : project.displayName,
      })),
    [projects.data, saved],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const projectId = selected ?? options[0]?.value ?? null;
  const remove = useMutation({
    mutationFn: (id: string) => clear({ projectId: id }),
    onSuccess: () => {
      void queries.invalidateQueries({ queryKey: ["linear"] });
      toast.show("Project key removed. The project uses the default key now.", {
        variant: "success",
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <SettingsSection title="Project keys">
      <SettingsCard>
        <SettingsRow
          label="Use a different Linear key for a project"
          hint="Workspaces in the project use its key. Other projects use the default key above."
        />
        {saved.map((entry) => (
          <SavedKeyRow
            key={entry.projectId}
            name={names.get(entry.projectId) ?? entry.projectId}
            projectId={entry.projectId}
            keyHint={entry.keyHint}
            disabled={remove.isPending}
            onRemove={remove.mutate}
          />
        ))}
        {projectId ? (
          <>
            <SettingsSelect
              label="Project"
              value={projectId}
              options={options}
              onValueChange={setSelected}
            />
            <SettingsRow label="Project API key" hint="Replaces the project's key if it has one.">
              <View style={FORM_STYLE}>
                <ApiKeyForm
                  key={projectId}
                  theme={theme}
                  projectId={projectId}
                  submitLabel="Save project key"
                />
              </View>
            </SettingsRow>
          </>
        ) : (
          <SettingsRow label="Project" hint="Add a project to Paseo first." />
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function SavedKeyRow(props: {
  name: string;
  projectId: string;
  keyHint: string;
  disabled: boolean;
  onRemove(projectId: string): void;
}) {
  const { onRemove, projectId } = props;
  const press = useCallback(() => onRemove(projectId), [onRemove, projectId]);
  return (
    <SettingsAction
      label={props.name}
      hint={`Key ${props.keyHint}`}
      actionLabel="Remove"
      disabled={props.disabled}
      onPress={press}
    />
  );
}
