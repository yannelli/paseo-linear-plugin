import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { LinearUser, WorkflowState } from "../shared/linear";
import { PRIORITIES } from "../shared/linear";
import { Avatar, OptionRow, PriorityIcon, StateIcon, type Theme, usePressableStyle } from "./ui";

export interface PickerOption {
  value: string;
  label: string;
  detail?: string;
  leading?: ReactNode;
}

interface PickerListProps {
  theme: Theme;
  title: string;
  options: readonly PickerOption[];
  value: string | null;
  searchable?: boolean;
  onSelect(value: string): void;
}

const MODAL_CONTENT_STYLE = { padding: 12, gap: 4 } as const;
const LIST_STYLE = { gap: 4 } as const;

function PickerItem(props: {
  theme: Theme;
  option: PickerOption;
  selected: boolean;
  onSelect(value: string): void;
}) {
  const { option, onSelect } = props;
  const press = useCallback(() => onSelect(option.value), [onSelect, option.value]);
  return (
    <OptionRow
      theme={props.theme}
      label={option.label}
      detail={option.detail}
      leading={option.leading}
      selected={props.selected}
      onPress={press}
    />
  );
}

function PickerList(props: PickerListProps) {
  const { colors } = props.theme;
  const [search, setSearch] = useState("");
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return props.options;
    return props.options.filter((option) =>
      `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(needle),
    );
  }, [props.options, search]);
  const styles = useMemo(
    () => ({
      input: {
        height: 36,
        marginBottom: 6,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        color: colors.foreground,
      },
      empty: { color: colors.foregroundMuted, padding: 12 },
    }),
    [colors],
  );
  return (
    <View style={LIST_STYLE}>
      {props.searchable ? (
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Filter"
          placeholderTextColor={colors.foregroundMuted}
          autoCapitalize="none"
          accessibilityLabel={`Filter ${props.title.toLowerCase()}`}
          style={styles.input}
        />
      ) : null}
      {visible.map((option) => (
        <PickerItem
          key={option.value}
          theme={props.theme}
          option={option}
          selected={option.value === props.value}
          onSelect={props.onSelect}
        />
      ))}
      {visible.length === 0 ? <Text style={styles.empty}>No matches</Text> : null}
    </View>
  );
}

// For surfaces outside a modal. Inside a modal, use PickerPage so sheets never nest.
export function PickerModal(
  props: PickerListProps & { icon: string; open: boolean; onClose(): void },
) {
  const { colors } = props.theme;
  const { onClose } = props;
  const icon = useMemo(
    () => <Icon name={props.icon} size={18} color={colors.foreground} />,
    [props.icon, colors.foreground],
  );
  const openChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <Modal title={props.title} icon={icon} open={props.open} onOpenChange={openChange}>
      <Modal.Content contentContainerStyle={MODAL_CONTENT_STYLE}>
        {props.open ? <PickerList {...props} /> : null}
      </Modal.Content>
    </Modal>
  );
}

export function PickerPage(props: PickerListProps & { onBack(): void }) {
  const { colors } = props.theme;
  const styles = useMemo(
    () =>
      ({
        root: { gap: 8 },
        back: { flexDirection: "row", alignItems: "center", gap: 6, height: 32 },
        title: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
      }) as const,
    [colors],
  );
  return (
    <View style={styles.root}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={props.onBack}
        style={styles.back}
      >
        <Icon name="ChevronLeft" size={16} color={colors.foregroundMuted} />
        <Text style={styles.title}>{props.title}</Text>
      </Pressable>
      <PickerList {...props} />
    </View>
  );
}

export const UNASSIGNED = "__unassigned__";

export function stateOptions(states: readonly WorkflowState[]): PickerOption[] {
  return states.map((state) => ({
    value: state.id,
    label: state.name,
    leading: <StateIcon state={state} />,
  }));
}

export function priorityOptions(theme: Theme): PickerOption[] {
  return PRIORITIES.map((priority) => ({
    value: String(priority.value),
    label: priority.label,
    leading: <PriorityIcon theme={theme} priority={priority.value} />,
  }));
}

export function assigneeOptions(
  theme: Theme,
  users: readonly LinearUser[],
  viewerId: string | null,
): PickerOption[] {
  const sorted = [...users].sort((a, b) => {
    if (a.id === viewerId) return -1;
    if (b.id === viewerId) return 1;
    return a.displayName.localeCompare(b.displayName);
  });
  return [
    { value: UNASSIGNED, label: "Unassigned", leading: <Avatar theme={theme} name={null} /> },
    ...sorted.map((user) => ({
      value: user.id,
      label: user.id === viewerId ? `${user.displayName} (you)` : user.displayName,
      detail: user.name !== user.displayName ? user.name : undefined,
      leading: <Avatar theme={theme} name={user.displayName} />,
    })),
  ];
}

export function PropertyChip(props: {
  theme: Theme;
  label: string;
  leading: ReactNode;
  accessibilityLabel: string;
  disabled?: boolean;
  onPress(): void;
}) {
  const { colors } = props.theme;
  const styles = useMemo(() => {
    const idle = {
      height: 30,
      paddingHorizontal: 10,
      borderRadius: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
      opacity: props.disabled ? 0.6 : 1,
    } as const;
    return {
      idle,
      active: { ...idle, backgroundColor: colors.surface2 },
      label: { color: colors.foreground, fontSize: 13, maxWidth: 180 },
      chevron: { marginLeft: -2 },
    };
  }, [colors, props.disabled]);
  const pressStyle = usePressableStyle(styles.idle, styles.active);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      disabled={props.disabled}
      onPress={props.onPress}
      style={pressStyle}
    >
      {props.leading}
      <Text numberOfLines={1} style={styles.label}>
        {props.label}
      </Text>
      <View style={styles.chevron}>
        <Icon name="ChevronDown" size={14} color={colors.foregroundMuted} />
      </View>
    </Pressable>
  );
}
