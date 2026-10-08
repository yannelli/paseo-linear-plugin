import { useRpc } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  areaLabel,
  knowledgeGetRpc,
  knowledgeInspectRpc,
  MAX_KNOWLEDGE_FILES,
  type ProjectBrief,
} from "../shared/knowledge";
import { errorMessage, relativeTime } from "./ui";

const AREAS_SHOWN = 24;

export const knowledgeKey = (projectId: string) => ["linear", "knowledge", projectId] as const;

function countText(entries: readonly { name: string; files: number }[]): string {
  return entries.map((entry) => `${entry.name} ${entry.files}`).join(", ");
}

function overview(brief: ProjectBrief): string {
  const source = brief.source === "git" ? "files git tracks" : "files found in the folder";
  const truncated = brief.truncated ? `; the first ${MAX_KNOWLEDGE_FILES.toLocaleString()} are kept` : "";
  return `${brief.fileCount} ${source}${truncated}. Inspected ${relativeTime(brief.inspectedAt)}.`;
}

/** What the daemon knows about the project's files, and a button to inspect it again. */
export function ProjectKnowledgeSection(props: { projectId: string }) {
  const { projectId } = props;
  const get = useRpc(knowledgeGetRpc);
  const inspect = useRpc(knowledgeInspectRpc);
  const queries = useQueryClient();
  const query = useQuery({
    queryKey: knowledgeKey(projectId),
    queryFn: () => get({ projectId }),
    staleTime: 60_000,
    retry: false,
  });
  const again = useMutation({
    mutationFn: () => inspect({ projectId }),
    onSuccess: (data) => queries.setQueryData(knowledgeKey(projectId), data),
  });
  const brief = query.data?.knowledge ?? null;
  const busy = query.isPending || again.isPending;
  const failure = again.error ?? query.error;
  const areas = brief?.areas.filter((area) => area.path !== "") ?? [];
  return (
    <SettingsSection title="Project knowledge">
      <SettingsCard>
        <SettingsAction
          label="Inspect the project"
          hint="The daemon lists the project's files and reads its manifests to find its services, packages, and main folders. No agent runs. Explore and setup agents, ticket-text maps, and Linear Live use what it finds. It inspects again when the knowledge is 6 hours old."
          actionLabel={busy ? "Inspecting…" : "Inspect again"}
          disabled={busy}
          onPress={() => again.mutate()}
        />
        {failure ? <SettingsRow label="Inspection did not finish" error={errorMessage(failure)} /> : null}
        {brief ? (
          <>
            <SettingsRow label="Files" hint={overview(brief)} />
            {brief.summary ? <SettingsRow label="Project" hint={brief.summary} /> : null}
            {brief.languages.length > 0 ? (
              <SettingsRow label="Languages" hint={countText(brief.languages)} />
            ) : null}
            {brief.commands.length > 0 ? (
              <SettingsRow label="Commands" hint={brief.commands.join(", ")} />
            ) : null}
            {brief.guides.length > 0 ? <SettingsRow label="Guides" hint={brief.guides.join(", ")} /> : null}
            {areas.slice(0, AREAS_SHOWN).map((area) => {
              const files = `${area.files} ${area.files === 1 ? "file" : "files"}`;
              const parts = [areaLabel(area), files, area.languages.join("/"), area.summary];
              return <SettingsRow key={area.path} label={area.path} hint={parts.filter(Boolean).join(" · ")} />;
            })}
            {areas.length > AREAS_SHOWN ? (
              <SettingsRow label={`${areas.length - AREAS_SHOWN} more areas`} />
            ) : null}
          </>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}
