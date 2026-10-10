import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { IssueDetail } from "../shared/linear";
import { type AgentPicks, optionLabel, resolveAgent } from "./agent-options";
import type { LaunchChoices } from "./launch-choices";
import { Chip } from "./launch-fields";
import { agentLabel, type SubIssueAgent } from "./launch-plan";
import { ModelBrowser } from "./model-browser";
import { PickerModal } from "./pickers";
import { ProviderIcon } from "./provider-icon";
import { IconButton, type Theme } from "./ui";

// The user picks an agent for some sub-issues. The agent that starts gets them in its prompt
// and hands each one off with start_agent, which runs it on the chosen agent.

type Picks = Record<string, AgentPicks>;

/** The agents chosen for sub-issues, in the order of the sub-issues. */
export function useSubIssueAgents(issue: IssueDetail, choices: LaunchChoices) {
  const [picks, setPicks] = useState<Picks>({});
  const { agents, remembered } = choices;
  const leadAgent = choices.agent?.agent.id ?? null;
  const leadMode = choices.agent?.mode?.id ?? null;
  const assignments = useMemo((): SubIssueAgent[] => {
    const result: SubIssueAgent[] = [];
    for (const child of issue.children) {
      const pick = picks[child.identifier];
      if (!pick) continue;
      // An agent of the same provider as the lead runs in the lead's mode.
      const mode = pick.mode ?? (pick.agent === leadAgent ? leadMode : null);
      const agent = resolveAgent(agents, { ...pick, mode }, "", remembered);
      if (agent) result.push({ identifier: child.identifier, agent });
    }
    return result;
  }, [issue.children, picks, agents, remembered, leadAgent, leadMode]);
  const choose = useCallback((identifier: string, pick: AgentPicks | null) => {
    setPicks((current) => {
      const { [identifier]: _previous, ...others } = current;
      return pick ? { ...others, [identifier]: pick } : others;
    });
  }, []);
  return { assignments, picks, choose };
}

type Open = { identifier: string; kind: "model" | "effort" } | null;

export function SubIssueAgents(props: {
  theme: Theme;
  issue: IssueDetail;
  choices: LaunchChoices;
  state: ReturnType<typeof useSubIssueAgents>;
  /** Why the section cannot be used, or null. */
  blocked: string | null;
}) {
  const { theme, issue, choices, state, blocked } = props;
  const { colors } = theme;
  const [open, setOpen] = useState<Open>(null);
  const styles = useMemo(
    () => ({
      hint: { color: colors.foregroundMuted, fontSize: 12 },
      row: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        columnGap: 8,
        rowGap: 2,
        paddingVertical: 4,
      },
      issue: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flexGrow: 1, flexBasis: 220, minWidth: 0 },
      key: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const },
      title: { flex: 1, color: colors.foreground, fontSize: 14 },
      controls: { flexDirection: "row" as const, alignItems: "center" as const, gap: 2 },
    }),
    [colors],
  );
  const byKey = useMemo(
    () => new Map(state.assignments.map((entry) => [entry.identifier, entry.agent])),
    [state.assignments],
  );
  const close = useCallback(() => setOpen(null), []);
  const { choose } = state;
  const selectModel = useCallback(
    (agentId: string, modelId: string) => {
      if (open) choose(open.identifier, { agent: agentId, model: modelId, effort: null, mode: null });
      setOpen(null);
    },
    [open, choose],
  );
  const selectEffort = useCallback(
    (effort: string) => {
      const pick = open ? state.picks[open.identifier] : undefined;
      if (open && pick) choose(open.identifier, { ...pick, effort });
      setOpen(null);
    },
    [open, state.picks, choose],
  );
  if (blocked) return <Text style={styles.hint}>{blocked}</Text>;
  const muted = colors.foregroundMuted;
  const current = open ? byKey.get(open.identifier) : undefined;
  return (
    <View>
      <Text style={styles.hint}>
        Choose an agent for a sub-issue, and the agent you start hands that sub-issue to it. It does the other sub-issues itself, or hands them off when Hand off work to Paseo agents is on.
      </Text>
      {issue.children.map((child) => {
        const agent = byKey.get(child.identifier);
        const label = agent ? `${agent.agent.label} · ${agent.model.label}` : "Not assigned";
        return (
          <View key={child.identifier} style={styles.row}>
            <View style={styles.issue}>
              <Text style={styles.key}>{child.identifier}</Text>
              <Text style={styles.title} numberOfLines={1}>
                {child.title}
              </Text>
            </View>
            <View style={styles.controls}>
              <Chip
                theme={theme}
                icon={
                  agent ? (
                    <ProviderIcon provider={agent.agent.id} iconSvg={agent.agent.iconSvg} size={16} color={muted} />
                  ) : (
                    <Icon name="Bot" size={16} color={muted} />
                  )
                }
                value={label}
                accessibilityLabel={`Agent for ${child.identifier}: ${label}`}
                disabled={choices.agents.length === 0}
                onPress={() => setOpen({ identifier: child.identifier, kind: "model" })}
              />
              {agent?.effort ? (
                <Chip
                  theme={theme}
                  icon={<Icon name="Brain" size={16} color={muted} />}
                  value={optionLabel(agent.effort)}
                  accessibilityLabel={`Thinking for ${child.identifier}: ${optionLabel(agent.effort)}`}
                  onPress={() => setOpen({ identifier: child.identifier, kind: "effort" })}
                />
              ) : null}
              {agent ? (
                <IconButton
                  theme={theme}
                  icon="X"
                  label={`Remove the agent for ${child.identifier}`}
                  onPress={() => choose(child.identifier, null)}
                />
              ) : null}
            </View>
          </View>
        );
      })}
      {open?.kind === "model" ? (
        <ModelBrowser
          theme={theme}
          agents={choices.agents}
          agentId={current?.agent.id ?? null}
          modelId={current?.model.id ?? null}
          onClose={close}
          onSelect={selectModel}
        />
      ) : null}
      {open?.kind === "effort" && current ? (
        <PickerModal
          theme={theme}
          title={`Thinking for ${open.identifier}`}
          icon="Brain"
          open
          options={current.model.efforts.map((entry) => ({ value: entry.id, label: optionLabel(entry) }))}
          value={current.effort?.id ?? null}
          onClose={close}
          onSelect={selectEffort}
        />
      ) : null}
    </View>
  );
}

/** Names for the prompt: each sub-issue key with its agent. */
export function promptAssignments(assignments: readonly SubIssueAgent[]) {
  return assignments.map((entry) => ({ identifier: entry.identifier, label: agentLabel(entry.agent) }));
}
