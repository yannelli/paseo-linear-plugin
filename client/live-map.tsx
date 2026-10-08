import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, type LayoutChangeEvent, StyleSheet, Text, View } from "react-native";
import { MONO } from "./live-issues";
import {
  type MapModel,
  type MapTile,
  type MapZone,
  masonry,
  ZONE_GAP,
  zoneAreaLabel,
} from "../shared/map-model";
import { NATIVE_DRIVER, type OwnerColors } from "./live-timeline";
import type { AgentMarker } from "./live-agents";
import { ProviderIcon } from "./provider-icon";
import type { Theme } from "./ui";

const ZONE_ICONS = { none: "Folder", listed: "FolderOpen", searched: "FolderSearch" } as const;
const MIN_ZONE_WIDTH = 260;
const MAX_COLUMNS = 4;
interface TileProps {
  theme: Theme;
  tile: MapTile;
  color: string | null;
  dim: boolean;
  /** Agents on this file now, and subagents asked about it. */
  markers: readonly AgentMarker[];
  reduceMotion: boolean;
}

const NO_MARKERS: readonly AgentMarker[] = [];

function MarkerBadge({ theme, marker }: { theme: Theme; marker: AgentMarker }) {
  const { colors } = theme;
  const sub = marker.kind === "subagent";
  const style = useMemo(
    () =>
      ({
        width: 16,
        height: 16,
        borderRadius: 8,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: sub ? 1 : 0,
        borderColor: colors.border,
        backgroundColor: sub ? colors.surface2 : marker.color,
      }) as const,
    [colors, sub, marker.color],
  );
  const tint = sub ? colors.foregroundMuted : colors.accentForeground;
  return (
    <View style={style} accessibilityLabel={marker.label}>
      {marker.provider ? (
        <ProviderIcon provider={marker.provider} size={10} color={tint} />
      ) : (
        <Icon name="Bot" size={10} color={tint} />
      )}
    </View>
  );
}

function tileLabel(tile: MapTile): string {
  if (tile.ghost) return `${tile.path}, not on the map`;
  const where = tile.onMap ? `on the map for ${tile.owner}` : "off the map";
  const touch = tile.touch === "none" ? "not touched" : tile.touch;
  return `${tile.path}, ${touch}, ${where}`;
}

function Tile({ theme, tile, color, dim, markers, reduceMotion }: TileProps) {
  const { colors } = theme;
  const active = markers.find((marker) => marker.kind !== "subagent");
  const current = active !== undefined;
  const touched = tile.touch !== "none";
  const offMap = touched && !tile.onMap;
  const tone = offMap ? colors.statusWarning : (color ?? colors.foregroundMuted);
  const filled = tile.touch === "edited" || tile.touch === "created";
  const [pulse] = useState(() => new Animated.Value(1));
  const [born] = useState(() => new Animated.Value(1));
  const wasTouched = useRef(touched);
  const styles = useMemo(() => {
    let borderColor = colors.border;
    if (active) borderColor = active.color;
    else if (offMap) borderColor = colors.statusWarning;
    else if (touched) borderColor = tone;
    return {
      root: {
        height: 26,
        paddingLeft: 8,
        paddingRight: 9,
        borderRadius: 7,
        borderWidth: tile.ghost ? 0 : 1,
        borderStyle: offMap ? "dashed" : "solid",
        borderColor,
        backgroundColor: tile.ghost ? "transparent" : touched ? colors.surface2 : colors.surface1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        maxWidth: "100%",
        opacity: (tile.ghost ? 0.4 : 1) * (dim ? 0.25 : 1),
      },
      fill: { ...StyleSheet.absoluteFillObject, borderRadius: 6, backgroundColor: tone, opacity: 0.16 },
      dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        borderWidth: 1.5,
        borderColor: tile.ghost ? colors.surface2 : tone,
        backgroundColor: touched ? tone : "transparent",
      },
      name: {
        flexShrink: 1,
        fontFamily: MONO,
        fontSize: 11.5,
        color: touched ? colors.foreground : colors.foregroundMuted,
      },
      chip: { color: colors.foregroundMuted, fontSize: 10 },
      added: { color: colors.statusSuccess, fontSize: 10 },
      removed: { color: colors.statusDanger, fontSize: 10 },
      badges: { position: "absolute", top: -7, right: -7, flexDirection: "row-reverse", gap: 2 },
    } as const;
  }, [colors, tile.ghost, touched, offMap, tone, current, active, dim]);
  const motion = useMemo(
    () => ({ maxWidth: "100%", transform: [{ scale: Animated.multiply(pulse, born) }] }) as const,
    [pulse, born],
  );
  useEffect(() => {
    if (touched === wasTouched.current) return;
    wasTouched.current = touched;
    if (!touched || reduceMotion) return;
    born.setValue(0.82);
    const animation = Animated.spring(born, {
      toValue: 1,
      friction: 5,
      tension: 160,
      useNativeDriver: NATIVE_DRIVER,
    });
    animation.start();
    return () => animation.stop();
  }, [touched, reduceMotion, born]);
  useEffect(() => {
    if (!current || reduceMotion) return;
    const animation = Animated.sequence([
      Animated.timing(pulse, { toValue: 1.08, duration: 140, useNativeDriver: NATIVE_DRIVER }),
      Animated.timing(pulse, { toValue: 1, duration: 220, useNativeDriver: NATIVE_DRIVER }),
    ]);
    animation.start();
    return () => {
      animation.stop();
      pulse.setValue(1);
    };
  }, [current, reduceMotion, pulse]);
  return (
    <Animated.View style={motion} accessible accessibilityLabel={tileLabel(tile)}>
      <View style={styles.root}>
        {filled ? <View style={styles.fill} /> : null}
        <View style={styles.dot} />
        <Text numberOfLines={1} style={styles.name}>
          {tile.name}
        </Text>
        {tile.touch === "created" ? <Text style={styles.chip}>new</Text> : null}
        {tile.added > 0 ? <Text style={styles.added}>{`+${tile.added}`}</Text> : null}
        {tile.removed > 0 ? <Text style={styles.removed}>{`-${tile.removed}`}</Text> : null}
      </View>
      {markers.length > 0 ? (
        <View style={styles.badges} pointerEvents="none">
          {markers.slice(0, 2).map((marker) => (
            <MarkerBadge key={marker.key} theme={theme} marker={marker} />
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}

function Zone(props: RepoMapProps & { zone: MapZone }) {
  const { theme, zone, focus } = props;
  const { colors } = theme;
  const hot = zone.touched > 0;
  const seen = hot || zone.explored !== "none";
  const styles = useMemo(
    () =>
      ({
        zone: {
          minWidth: 0,
          padding: 12,
          gap: 10,
          borderRadius: 12,
          borderWidth: 1,
          borderStyle: seen ? "solid" : "dashed",
          borderColor: colors.border,
          backgroundColor: seen ? colors.surface1 : "transparent",
        },
        ring: {
          ...StyleSheet.absoluteFillObject,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.foregroundMuted,
          opacity: 0.35,
        },
        header: { flexDirection: "row", alignItems: "center", gap: 6 },
        dir: { flexShrink: 1, color: colors.foregroundMuted, fontFamily: MONO, fontSize: 11 },
        area: { flex: 1, color: colors.foregroundMuted, fontSize: 11, opacity: 0.8 },
        count: { color: hot ? colors.foreground : colors.foregroundMuted, fontSize: 11 },
        tiles: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
      }) as const,
    [colors, props.compact, seen, hot],
  );
  const off = zone.touched - zone.hits;
  let count: string | null = null;
  if (zone.predicted > 0) count = `${zone.hits}/${zone.predicted}${off > 0 ? ` +${off} off` : ""}`;
  else if (off > 0) count = `${off} off the map`;
  const area = zoneAreaLabel(zone);
  return (
    <View style={styles.zone}>
      {hot ? <View pointerEvents="none" style={styles.ring} /> : null}
      <View style={styles.header}>
        <Icon
          name={ZONE_ICONS[zone.explored]}
          size={12}
          color={seen ? colors.foreground : colors.foregroundMuted}
        />
        <Text numberOfLines={1} style={styles.dir}>
          {zone.dir || "./"}
        </Text>
        <Text numberOfLines={1} style={styles.area}>
          {area ?? ""}
        </Text>
        {count ? <Text style={styles.count}>{count}</Text> : null}
      </View>
      <View style={styles.tiles}>
        {zone.tiles.map((tile) => (
          <Tile
            key={tile.path}
            theme={theme}
            tile={tile}
            color={tile.owner ? (props.colors.get(tile.owner) ?? null) : null}
            dim={focus !== null && tile.owner !== focus}
            markers={tile.ghost ? NO_MARKERS : (props.markers.get(tile.path) ?? NO_MARKERS)}
            reduceMotion={props.reduceMotion}
          />
        ))}
      </View>
    </View>
  );
}

export interface RepoMapProps {
  theme: Theme;
  compact: boolean;
  model: MapModel;
  colors: OwnerColors;
  focus: string | null;
  /** Agents on each file now, and subagents asked about it. */
  markers: ReadonlyMap<string, AgentMarker[]>;
  reduceMotion: boolean;
}

export function RepoMap(props: RepoMapProps) {
  const { colors } = props.theme;
  const [width, setWidth] = useState(0);
  const measure = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);
  const columns = props.compact
    ? 1
    : Math.max(1, Math.min(MAX_COLUMNS, Math.floor((width + ZONE_GAP) / (MIN_ZONE_WIDTH + ZONE_GAP))));
  // Zones keep their column while the agent works, so growing zones do not reshuffle the map.
  const placed = useRef({ columns: 0, byDir: new Map<string, number>() });
  const groups = useMemo(() => {
    const count = width > 0 ? columns : 1;
    if (placed.current.columns !== count) placed.current = { columns: count, byDir: new Map() };
    return masonry(props.model.zones, count, width || MIN_ZONE_WIDTH, placed.current.byDir);
  }, [props.model.zones, columns, width]);
  const styles = useMemo(
    () =>
      ({
        zones: { flexDirection: "row", gap: ZONE_GAP, alignItems: "flex-start" },
        column: { flex: 1, minWidth: 0, gap: ZONE_GAP },
        empty: { color: colors.foregroundMuted, fontSize: 13 },
        hidden: { opacity: 0 },
      }) as const,
    [colors],
  );
  // The measured View stays mounted, so the first files do not draw in one column and then reflow.
  return (
    <View onLayout={measure}>
      {props.model.zones.length === 0 ? (
        <Text style={styles.empty}>No files on the map yet. Files the agent opens show here.</Text>
      ) : (
        <View style={[styles.zones, width > 0 ? null : styles.hidden]}>
          {groups.map((group, index) => (
            <View key={index} style={styles.column}>
              {group.map((zone) => (
                <Zone key={zone.dir} {...props} zone={zone} />
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** Explains the tile styles; shown in the map card header. */
export function MapLegend({ theme }: { theme: Theme }) {
  const { colors } = theme;
  const styles = useMemo(() => {
    const swatch = {
      width: 18,
      height: 12,
      borderRadius: 4,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    } as const;
    const dot = { width: 5, height: 5, borderRadius: 3, borderWidth: 1 } as const;
    return {
      row: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
      item: { flexDirection: "row", alignItems: "center", gap: 5 },
      text: { color: colors.foregroundMuted, fontSize: 11 },
      mapped: { ...swatch, borderColor: colors.border, backgroundColor: colors.surface1 },
      touched: { ...swatch, borderColor: colors.accent, backgroundColor: colors.surface2 },
      off: { ...swatch, borderStyle: "dashed", borderColor: colors.statusWarning },
      hollow: { ...dot, borderColor: colors.accent },
      solid: { ...dot, borderColor: colors.accent, backgroundColor: colors.accent },
      warn: { ...dot, borderColor: colors.statusWarning, backgroundColor: colors.statusWarning },
    } as const;
  }, [colors]);
  return (
    <View style={styles.row}>
      <View style={styles.item}>
        <View style={styles.mapped}>
          <View style={styles.hollow} />
        </View>
        <Text style={styles.text}>Predicted</Text>
      </View>
      <View style={styles.item}>
        <View style={styles.touched}>
          <View style={styles.solid} />
        </View>
        <Text style={styles.text}>Touched</Text>
      </View>
      <View style={styles.item}>
        <View style={styles.off}>
          <View style={styles.warn} />
        </View>
        <Text style={styles.text}>Off the map</Text>
      </View>
    </View>
  );
}
