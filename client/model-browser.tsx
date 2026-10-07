import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Platform, Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { type AgentChoice, type ModelChoice, searchModels } from "./agent-options";
import { ProviderIcon } from "./provider-icon";
import type { Theme } from "./ui";

export interface ModelBrowserProps {
  theme: Theme;
  agents: readonly AgentChoice[];
  agentId: string | null;
  modelId: string | null;
  onClose(): void;
  onSelect(agentId: string, modelId: string): void;
}

const CONTENT_STYLE = { padding: 0, gap: 0 } as const;

function modelCount(agent: AgentChoice): string {
  return agent.models.length === 1 ? "1 model" : `${agent.models.length} models`;
}

function useBrowserStyles(theme: Theme) {
  const { colors } = theme;
  return useMemo(() => {
    const row = {
      minHeight: 36,
      paddingVertical: 8,
      paddingHorizontal: 12,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
    };
    return {
      row,
      rowHovered: { ...row, backgroundColor: colors.surface1 },
      rowPressed: { ...row, backgroundColor: colors.surface2 },
      separator: { height: 1, backgroundColor: colors.border },
      slot: { width: 16, alignItems: "center" as const },
      search: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      // Web only. Paseo's own search fields hide the focus outline the same way.
      input: {
        flex: 1,
        paddingVertical: 8,
        fontSize: 14,
        color: colors.foreground,
        ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : {}),
      },
      section: {
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 4,
        fontSize: 12,
        color: colors.foregroundMuted,
      },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
      },
      title: { flex: 1, fontSize: 14, fontWeight: "500" as const, color: colors.foreground },
      label: { fontSize: 14, color: colors.foreground, flexShrink: 0 },
      providerLabel: { flex: 1, fontSize: 14, color: colors.foreground },
      muted: { fontSize: 12, color: colors.foregroundMuted },
      description: { flex: 1, minWidth: 0, fontSize: 12, color: colors.foregroundMuted },
      text: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row" as const,
        alignItems: "baseline" as const,
        gap: 8,
      },
      empty: { alignItems: "center" as const, gap: 8, padding: 24 },
    };
  }, [colors]);
}

type BrowserStyles = ReturnType<typeof useBrowserStyles>;

function useRowStyle(styles: BrowserStyles) {
  return useCallback(
    (state: PressableStateCallbackType) =>
      state.pressed
        ? styles.rowPressed
        : (state as { hovered?: boolean }).hovered
          ? styles.rowHovered
          : styles.row,
    [styles],
  );
}

function ModelRow(props: {
  theme: Theme;
  styles: BrowserStyles;
  agent: AgentChoice;
  model: ModelChoice;
  description: string;
  selected: boolean;
  onSelect(agentId: string, modelId: string): void;
}) {
  const { theme, styles, agent, model, onSelect } = props;
  const muted = theme.colors.foregroundMuted;
  const press = useCallback(() => onSelect(agent.id, model.id), [onSelect, agent.id, model.id]);
  const rowStyle = useRowStyle(styles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${agent.label} ${model.label}`}
      accessibilityState={{ selected: props.selected }}
      onPress={press}
      style={rowStyle}
    >
      <View style={styles.slot}>
        <ProviderIcon provider={agent.id} iconSvg={agent.iconSvg} size={14} color={muted} />
      </View>
      <View style={styles.text}>
        <Text numberOfLines={1} style={styles.label}>
          {model.label}
        </Text>
        <Text numberOfLines={1} style={styles.description}>
          {props.description}
        </Text>
      </View>
      <View style={styles.slot}>
        {props.selected ? <Icon name="Check" size={14} color={muted} /> : null}
      </View>
    </Pressable>
  );
}

function ProviderRow(props: {
  theme: Theme;
  styles: BrowserStyles;
  agent: AgentChoice;
  onOpen(agentId: string): void;
}) {
  const { theme, styles, agent, onOpen } = props;
  const muted = theme.colors.foregroundMuted;
  const press = useCallback(() => onOpen(agent.id), [onOpen, agent.id]);
  const rowStyle = useRowStyle(styles);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${agent.label}, ${modelCount(agent)}`}
      onPress={press}
      style={rowStyle}
    >
      <View style={styles.slot}>
        <ProviderIcon provider={agent.id} iconSvg={agent.iconSvg} size={14} color={muted} />
      </View>
      <Text numberOfLines={1} style={styles.providerLabel}>
        {agent.label}
      </Text>
      <Text style={styles.muted}>{modelCount(agent)}</Text>
      <Icon name="ChevronRight" size={14} color={muted} />
    </Pressable>
  );
}

function rowsWithSeparators<T>(
  items: readonly T[],
  styles: BrowserStyles,
  row: (item: T) => {
    key: string;
    node: ReactNode;
  },
) {
  return items.map((item, index) => {
    const { key, node } = row(item);
    return (
      <View key={key}>
        {index > 0 ? <View style={styles.separator} /> : null}
        {node}
      </View>
    );
  });
}

// Paseo's model picker: providers first, then the models of one provider. Search covers all models.
export function ModelBrowser(props: ModelBrowserProps) {
  const { theme, agents, onSelect, onClose } = props;
  const { colors } = theme;
  const styles = useBrowserStyles(theme);
  const [openAgentId, setOpenAgentId] = useState<string | null>(
    agents.length === 1 ? (agents[0]?.id ?? null) : null,
  );
  const [query, setQuery] = useState("");
  const openAgent = agents.find((agent) => agent.id === openAgentId) ?? null;
  const showProvider = useCallback((agentId: string) => {
    setOpenAgentId(agentId);
    setQuery("");
  }, []);
  const back = useCallback(() => {
    setOpenAgentId(null);
    setQuery("");
  }, []);
  const openChange = useCallback((open: boolean) => (open ? undefined : onClose()), [onClose]);
  const matches = useMemo(() => {
    if (openAgent) {
      return query.trim()
        ? searchModels([openAgent], query)
        : openAgent.models.map((model) => ({ agent: openAgent, model }));
    }
    return searchModels(agents, query);
  }, [agents, openAgent, query]);
  const isSelected = (agent: AgentChoice, model: ModelChoice) =>
    agent.id === props.agentId && model.id === props.modelId;

  const modelRows = matches.map(({ agent, model }) => (
    <ModelRow
      key={`${agent.id}/${model.id}`}
      theme={theme}
      styles={styles}
      agent={agent}
      model={model}
      description={
        openAgent
          ? (model.description ?? model.id)
          : `${agent.label} · ${model.description ?? model.id}`
      }
      selected={isSelected(agent, model)}
      onSelect={onSelect}
    />
  ));
  const listingProviders = !openAgent && !query.trim();
  return (
    <Modal title="Select model" open onOpenChange={openChange}>
      <Modal.Content contentContainerStyle={CONTENT_STYLE}>
        {openAgent ? (
          <View style={styles.header}>
            {agents.length > 1 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="All providers"
                hitSlop={8}
                onPress={back}
              >
                <Icon name="ArrowLeft" size={16} color={colors.foregroundMuted} />
              </Pressable>
            ) : null}
            <ProviderIcon
              provider={openAgent.id}
              iconSvg={openAgent.iconSvg}
              size={16}
              color={colors.foreground}
            />
            <Text numberOfLines={1} style={styles.title}>
              {openAgent.label}
            </Text>
          </View>
        ) : null}
        <View style={styles.search}>
          <Icon name="Search" size={14} color={colors.foregroundMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={openAgent ? "Search models..." : "Search all models..."}
            placeholderTextColor={colors.foregroundMuted}
            autoCapitalize="none"
            autoFocus
            accessibilityLabel={openAgent ? "Search models" : "Search all models"}
            style={styles.input}
          />
        </View>
        {listingProviders ? (
          <>
            <Text style={styles.section}>Providers</Text>
            {rowsWithSeparators(agents, styles, (agent) => ({
              key: agent.id,
              node: (
                <ProviderRow theme={theme} styles={styles} agent={agent} onOpen={showProvider} />
              ),
            }))}
          </>
        ) : (
          modelRows
        )}
        {!listingProviders && matches.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="Search" size={16} color={colors.foregroundMuted} />
            <Text style={styles.muted}>{`No models match "${query.trim()}"`}</Text>
          </View>
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
