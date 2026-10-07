import { openExternalUrl, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { IssueCard } from "../shared/linear";
import { ACTION_LABELS } from "../shared/prompts";
import { usePressableStyle } from "./ui";

export function IssueCardRow({ item, theme }: PluginTimelineItemProps<IssueCard>) {
  const card = item.data;
  const { colors } = theme;
  const styles = useMemo(() => {
    const idle = {
      alignSelf: "flex-start" as const,
      maxWidth: "100%" as const,
      marginVertical: 4,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface1,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
    };
    return {
      idle,
      active: { ...idle, backgroundColor: colors.surface2 },
      body: { flexShrink: 1, gap: 2 },
      title: { color: colors.foreground, fontSize: 14 },
      identifier: { color: colors.foregroundMuted },
      meta: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: card.stateColor },
      detail: { color: colors.foregroundMuted, fontSize: 12 },
    };
  }, [colors, card.stateColor]);
  const style = usePressableStyle(styles.idle, styles.active);
  const open = useCallback(() => void openExternalUrl(card.url), [card.url]);
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Linear issue ${card.identifier}: ${card.title}. Open in Linear`}
      onPress={open}
      style={style}
    >
      <Icon name="SquareKanban" size={16} color={colors.foregroundMuted} />
      <View style={styles.body}>
        <Text numberOfLines={1} style={styles.title}>
          <Text style={styles.identifier}>{`${card.identifier}  `}</Text>
          {card.title}
        </Text>
        <View style={styles.meta}>
          <View style={styles.dot} />
          <Text style={styles.detail}>
            {`${card.stateName} · ${ACTION_LABELS[card.action].title} agent started from Linear`}
          </Text>
        </View>
      </View>
      <Icon name="ExternalLink" size={14} color={colors.foregroundMuted} />
    </Pressable>
  );
}
