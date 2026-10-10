import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import {
  type LinearSettings,
  type ProjectAccess,
  projectEnabled,
  withProjectAccess,
} from "../shared/settings";
import { publishAccess } from "./access";
import type { PaseoProjectOption } from "./queries";

type Edit = (change: (current: LinearSettings) => LinearSettings) => void;

/** Where Linear works: one switch for every project, then one per project. */
export function AccessSection(props: {
  access: ProjectAccess;
  saved: ProjectAccess;
  projects: readonly PaseoProjectOption[] | undefined;
  edit: Edit;
}) {
  const { access, saved, edit } = props;
  useEffect(() => publishAccess(saved), [saved]);
  const setAccess = (next: (current: ProjectAccess) => ProjectAccess) =>
    edit((current) => ({ ...current, access: next(current.access) }));
  return (
    <SettingsSection title="Use Linear in">
      <SettingsCard>
        <SettingsSwitch
          label="All projects"
          hint={
            access.allProjects
              ? "On everywhere. Turn off a project below to hide Linear there."
              : "Off everywhere. Turn on a project below to use Linear there."
          }
          value={access.allProjects}
          onValueChange={(allProjects) => setAccess((current) => ({ ...current, allProjects }))}
        />
        {(props.projects ?? []).map((project) => (
          <SettingsSwitch
            key={project.projectId}
            label={project.displayName}
            hint={
              access.projects[project.projectId] === undefined
                ? "Follows All projects"
                : project.rootPath
            }
            value={projectEnabled(access, project.projectId)}
            onValueChange={(enabled) =>
              setAccess((current) => withProjectAccess(current, project.projectId, enabled))
            }
          />
        ))}
      </SettingsCard>
    </SettingsSection>
  );
}
