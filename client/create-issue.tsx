import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { createIssueRpc, type LinearTeam, type LinearUser } from "../shared/linear";
import {
  assigneeOptions,
  type PickerOption,
  PickerPage,
  priorityOptions,
  PropertyChip,
  stateOptions,
  UNASSIGNED,
} from "./pickers";
import { useKeyScope } from "./key-scope";
import { queryKeys } from "./queries";
import {
  Avatar,
  Button,
  errorMessage,
  priorityMeta,
  PriorityIcon,
  StateIcon,
  type Theme,
} from "./ui";

type Picker = "team" | "state" | "priority" | "assignee";

interface CreateIssueProps {
  theme: Theme;
  teams: readonly LinearTeam[];
  users: readonly LinearUser[];
  viewerId: string | null;
  defaultTeamId: string | null;
  onClose(): void;
  onCreated(issueId: string): void;
}

interface Draft {
  teamId: string | null;
  stateId: string | null;
  priority: number;
  assigneeId: string | null;
}

const PICKER_TITLES: Record<Picker, string> = {
  team: "Team",
  state: "Status",
  priority: "Priority",
  assignee: "Assignee",
};

function pickerOptions(kind: Picker, props: CreateIssueProps, team: LinearTeam | null) {
  if (kind === "team") {
    return props.teams.map((entry) => ({ value: entry.id, label: entry.name, detail: entry.key }));
  }
  if (kind === "state") return stateOptions(team?.states ?? []);
  if (kind === "priority") return priorityOptions(props.theme);
  return assigneeOptions(props.theme, props.users, props.viewerId);
}

function pickerValue(kind: Picker, draft: Draft): string | null {
  if (kind === "team") return draft.teamId;
  if (kind === "state") return draft.stateId;
  if (kind === "priority") return String(draft.priority);
  return draft.assigneeId ?? UNASSIGNED;
}

function applyPick(kind: Picker, value: string, draft: Draft): Draft {
  if (kind === "team") return { ...draft, teamId: value, stateId: null };
  if (kind === "state") return { ...draft, stateId: value };
  if (kind === "priority") return { ...draft, priority: Number(value) };
  return { ...draft, assigneeId: value === UNASSIGNED ? null : value };
}

export function CreateIssueModal(props: CreateIssueProps) {
  const { theme, onClose, onCreated } = props;
  const { colors } = theme;
  const toast = useToast();
  const queries = useQueryClient();
  const createIssue = useRpc(createIssueRpc);
  const scope = useKeyScope();
  const [draft, setDraft] = useState<Draft>(() => ({
    teamId: props.defaultTeamId ?? props.teams[0]?.id ?? null,
    stateId: null,
    priority: 0,
    assigneeId: props.viewerId,
  }));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [picker, setPicker] = useState<Picker | null>(null);
  const team = props.teams.find((entry) => entry.id === draft.teamId) ?? null;

  const create = useMutation({
    mutationFn: () => {
      if (!draft.teamId) throw new Error("Choose a team");
      return createIssue({
        teamId: draft.teamId,
        title,
        description: description.trim() || undefined,
        priority: draft.priority,
        assigneeId: draft.assigneeId,
        ...(draft.stateId ? { stateId: draft.stateId } : {}),
        projectId: scope,
      });
    },
    onSuccess: ({ issue }) => {
      void queries.invalidateQueries({ queryKey: queryKeys.issues(scope) });
      toast.show(`Created ${issue.identifier}`, { variant: "success" });
      onCreated(issue.id);
    },
  });
  const { mutate } = create;
  const submit = useCallback(() => mutate(), [mutate]);
  const icon = useMemo(() => <Icon name="Plus" size={18} color={colors.foreground} />, [colors]);
  const openChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  const closePicker = useCallback(() => setPicker(null), []);
  const select = useCallback(
    (value: string) => {
      if (!picker) return;
      setDraft((current) => applyPick(picker, value, current));
      setPicker(null);
    },
    [picker],
  );
  const options: PickerOption[] = useMemo(
    () => (picker ? pickerOptions(picker, props, team) : []),
    [picker, props, team],
  );
  const styles = useMemo(() => {
    const input = {
      paddingHorizontal: 12,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
      color: colors.foreground,
      fontSize: 14,
    };
    return {
      title: { ...input, height: 42, fontSize: 15 },
      description: {
        ...input,
        minHeight: 120,
        paddingVertical: 10,
        textAlignVertical: "top" as const,
      },
      error: { color: colors.statusDanger, fontSize: 13 },
    };
  }, [colors]);

  return (
    <Modal title="New issue" icon={icon} open onOpenChange={openChange}>
      <Modal.Content>
        {picker ? (
          <PickerPage
            theme={theme}
            title={PICKER_TITLES[picker]}
            options={options}
            value={pickerValue(picker, draft)}
            searchable={picker === "assignee" || picker === "team"}
            onBack={closePicker}
            onSelect={select}
          />
        ) : (
          <>
            <DraftChips
              theme={theme}
              draft={draft}
              team={team}
              users={props.users}
              onPick={setPicker}
            />
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Issue title"
              placeholderTextColor={colors.foregroundMuted}
              accessibilityLabel="Issue title"
              autoFocus
              style={styles.title}
            />
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              placeholder="Add a description (Markdown)"
              placeholderTextColor={colors.foregroundMuted}
              accessibilityLabel="Issue description"
              style={styles.description}
            />
            {create.error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {errorMessage(create.error)}
              </Text>
            ) : null}
            <Button
              theme={theme}
              variant="primary"
              size="md"
              icon="Plus"
              label="Create issue"
              busy={create.isPending}
              disabled={!title.trim() || !draft.teamId}
              onPress={submit}
            />
          </>
        )}
      </Modal.Content>
    </Modal>
  );
}

const CHIPS_STYLE = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;

function DraftChips(props: {
  theme: Theme;
  draft: Draft;
  team: LinearTeam | null;
  users: readonly LinearUser[];
  onPick(kind: Picker): void;
}) {
  const { theme, draft, team, onPick } = props;
  const { colors } = theme;
  const state = team?.states.find((entry) => entry.id === draft.stateId) ?? null;
  const assignee = props.users.find((user) => user.id === draft.assigneeId) ?? null;
  const assigneeName = assignee?.displayName ?? null;
  const teamIcon = useMemo(
    () => <Icon name="Users" size={14} color={colors.foregroundMuted} />,
    [colors],
  );
  const stateIcon = useMemo(
    () =>
      state ? (
        <StateIcon state={state} size={14} />
      ) : (
        <Icon name="Circle" size={14} color={colors.foregroundMuted} />
      ),
    [state, colors],
  );
  const priorityIcon = useMemo(
    () => <PriorityIcon theme={theme} priority={draft.priority} size={14} />,
    [theme, draft.priority],
  );
  const avatar = useMemo(
    () => <Avatar theme={theme} name={assigneeName} size={16} />,
    [theme, assigneeName],
  );
  const pickTeam = useCallback(() => onPick("team"), [onPick]);
  const pickState = useCallback(() => onPick("state"), [onPick]);
  const pickPriority = useCallback(() => onPick("priority"), [onPick]);
  const pickAssignee = useCallback(() => onPick("assignee"), [onPick]);
  return (
    <View style={CHIPS_STYLE}>
      <PropertyChip
        theme={theme}
        label={team?.name ?? "Team"}
        leading={teamIcon}
        accessibilityLabel="Team"
        onPress={pickTeam}
      />
      <PropertyChip
        theme={theme}
        label={state?.name ?? "Default status"}
        leading={stateIcon}
        accessibilityLabel="Status"
        onPress={pickState}
      />
      <PropertyChip
        theme={theme}
        label={priorityMeta(draft.priority).label}
        leading={priorityIcon}
        accessibilityLabel="Priority"
        onPress={pickPriority}
      />
      <PropertyChip
        theme={theme}
        label={assigneeName ?? "Unassigned"}
        leading={avatar}
        accessibilityLabel="Assignee"
        onPress={pickAssignee}
      />
    </View>
  );
}
