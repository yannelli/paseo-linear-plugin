import { useRpc } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { initStartRpc, initStatusRpc } from "../shared/live";
import {
  applyProposal,
  type FieldDiff,
  type ProposalField,
  proposalDiffs,
} from "../shared/project-setup";
import type { ProjectConfig } from "../shared/settings";
import { knowledgeKey } from "./project-knowledge";
import { Button, errorMessage, type Theme } from "./ui";

// Setup runs on the daemon. Remember the job per project so leaving the screen keeps it.
const jobsByProject = new Map<string, string>();

export function ProjectSetup(props: {
  theme: Theme;
  config: ProjectConfig;
  change(patch: Partial<ProjectConfig>): void;
  /** Opens the setup agent while it runs; absent on hosts without navigation. */
  openAgent?: (agentId: string) => void;
}) {
  const { theme, config, change, openAgent } = props;
  const start = useRpc(initStartRpc);
  const status = useRpc(initStatusRpc);
  const [jobId, setJobId] = useState(() => jobsByProject.get(config.projectId) ?? null);
  useEffect(() => setJobId(jobsByProject.get(config.projectId) ?? null), [config.projectId]);
  const begin = useMutation({
    mutationFn: () => start({ projectId: config.projectId, rootPath: config.rootPath }),
    onSuccess: ({ job }) => {
      jobsByProject.set(config.projectId, job.id);
      setJobId(job.id);
    },
  });
  const job = useQuery({
    queryKey: ["linear", "init", jobId],
    queryFn: () => status({ jobId: jobId ?? "" }),
    enabled: jobId !== null,
    refetchInterval: (query) => (query.state.data?.job?.status === "running" ? 3_000 : false),
  });
  const state = job.data?.job ?? null;
  const proposal = job.data?.proposal ?? null;
  // The daemon saved the agent's area summaries; show them in Project knowledge.
  const queries = useQueryClient();
  const finished = state?.status === "done";
  useEffect(() => {
    if (finished) void queries.invalidateQueries({ queryKey: knowledgeKey(config.projectId) });
  }, [finished, queries, config.projectId]);
  const diffs = useMemo(
    () => (proposal ? proposalDiffs(config, proposal) : []),
    [config, proposal],
  );
  const [rejected, setRejected] = useState<ReadonlySet<ProposalField>>(new Set());
  const apply = useCallback(() => {
    if (!proposal) return;
    const chosen = new Set(diffs.map((diff) => diff.field).filter((f) => !rejected.has(f)));
    change(applyProposal(proposal, chosen));
    jobsByProject.delete(config.projectId);
    setJobId(null);
    setRejected(new Set());
  }, [proposal, diffs, rejected, change, config.projectId]);
  const dismiss = useCallback(() => {
    jobsByProject.delete(config.projectId);
    setJobId(null);
  }, [config.projectId]);

  const running = begin.isPending || state?.status === "running";
  const failure = begin.error
    ? errorMessage(begin.error)
    : state?.status === "failed"
      ? (state.error ?? "Setup failed")
      : null;
  return (
    <SettingsSection title="Set up with an agent">
      <SettingsCard>
        <SettingsAction
          label="Read this repository's guidelines"
          hint="The daemon inspects the project first, and the agent starts from that project map. The agent reads AGENTS.md, CONTRIBUTING, scripts, and CI, then proposes instructions and steps, and describes each area for Project knowledge. It is told not to edit. You review each prompt change before it is used."
          actionLabel={running ? "Reading…" : proposal ? "Run again" : "Start"}
          disabled={running || !config.rootPath}
          onPress={() => begin.mutate()}
        />
        {running ? (
          <SettingsRow
            label={state?.agentId ? "The setup agent is reading the repository." : "Inspecting the project…"}
          >
            {state?.agentId && openAgent ? (
              <View style={ACTIONS_STYLE}>
                <Button
                  theme={theme}
                  icon="Bot"
                  label="Open agent"
                  onPress={() => openAgent(state.agentId ?? "")}
                />
              </View>
            ) : null}
          </SettingsRow>
        ) : null}
        {failure ? <SettingsRow label="Setup did not finish" error={failure} /> : null}
        {state?.status === "done" && diffs.length === 0 ? (
          <SettingsAction
            label="The agent found nothing new to add."
            actionLabel="Dismiss"
            onPress={dismiss}
          />
        ) : null}
        {diffs.map((diff) => (
          <ProposalRow
            key={diff.field}
            theme={theme}
            diff={diff}
            accepted={!rejected.has(diff.field)}
            onToggle={(accepted) =>
              setRejected((current) => {
                const next = new Set(current);
                if (accepted) next.delete(diff.field);
                else next.add(diff.field);
                return next;
              })
            }
          />
        ))}
        {diffs.length > 0 ? (
          <SettingsRow label="Accepted changes go into the draft. Save to keep them.">
            <View style={ACTIONS_STYLE}>
              <Button theme={theme} variant="primary" label="Use accepted changes" onPress={apply} />
              <Button theme={theme} label="Dismiss" onPress={dismiss} />
            </View>
          </SettingsRow>
        ) : null}
      </SettingsCard>
    </SettingsSection>
  );
}

const ACTIONS_STYLE = { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" } as const;

function ProposalRow(props: {
  theme: Theme;
  diff: FieldDiff;
  accepted: boolean;
  onToggle(accepted: boolean): void;
}) {
  const { colors } = props.theme;
  const styles = useMemo(
    () => ({
      block: {
        marginTop: 6,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        gap: 4,
      },
      caption: { color: colors.foregroundMuted, fontSize: 12 },
      removed: { color: colors.foregroundMuted, fontSize: 13, lineHeight: 19 },
      added: { color: colors.foreground, fontSize: 13, lineHeight: 19 },
    }),
    [colors],
  );
  const { diff } = props;
  return (
    <SettingsSwitch
      label={diff.label}
      hint={props.accepted ? "Accepted" : "Skipped"}
      value={props.accepted}
      onValueChange={props.onToggle}
    >
      {diff.current ? (
        <View style={styles.block}>
          <Text style={styles.caption}>Now</Text>
          <Text style={styles.removed}>{diff.current}</Text>
        </View>
      ) : null}
      <View style={styles.block}>
        <Text style={styles.caption}>Proposed</Text>
        <Text style={styles.added}>{diff.proposed}</Text>
      </View>
    </SettingsSwitch>
  );
}
