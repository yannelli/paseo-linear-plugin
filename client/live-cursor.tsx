import { Icon } from "@getpaseo/plugin/client/react-native";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Text, View } from "react-native";
import { type Point, pointAt, type Route, route } from "../shared/graph-geometry";
import { type Graph, graphPath } from "../shared/graph-model";
import type { CursorAgent } from "./live-agents";
import { NATIVE_DRIVER } from "./live-timeline";
import { ProviderIcon } from "./provider-icon";
import type { Theme } from "./ui";

// An agent hovers over the node it works on. When the work moves, it glides along the shortest
// walk of imports and issues to the next node, in one eased motion.

type Coordinate = number | Animated.Value | Animated.AnimatedInterpolation<number>;

interface Motion {
  x: Coordinate;
  y: Coordinate;
}

const BADGE = 26;
export const CAPTION_ROOM = 210;
const MAX_SATELLITES = 3;

function glideTime(length: number): number {
  return Math.min(1200, Math.max(420, 380 + length * 0.8));
}

export interface CursorProps {
  theme: Theme;
  agent: CursorAgent;
  graph: Graph;
  /** Node id the agent works on. */
  target: string;
  /** Changes when node positions change. */
  layoutKey: string;
  /** Where the cursor hovers over a node. */
  hover(id: string): Point | null;
  /** Canvas width, to keep the caption inside it. */
  width: number;
  /** One over the graph zoom, so the cursor keeps its size on screen. */
  inverse: Animated.AnimatedInterpolation<number>;
  reduce: boolean;
}

export const AgentCursor = memo(function AgentCursor(props: CursorProps) {
  const { theme, agent, target, reduce } = props;
  const { colors } = theme;
  const [bob] = useState(() => new Animated.Value(0));
  const [halo] = useState(() => new Animated.Value(0));
  const [spin] = useState(() => new Animated.Value(0));
  const [motion, setMotion] = useState<Motion | null>(null);
  const [flip, setFlip] = useState(false);
  const latest = useRef(props);
  latest.current = props;
  // Each glide gets its own value, so binding a new route never jumps to the old start.
  const active = useRef<{ value: Animated.Value; path: Route; layoutKey: string } | null>(null);
  const state = useRef({
    at: null as string | null,
    point: null as Point | null,
    moving: false,
    pending: null as string | null,
  });

  // These read only refs, so the animation callbacks never see stale props.
  const land = (point: Point) => {
    state.current.point = point;
    setFlip(point.x > latest.current.width - CAPTION_ROOM);
  };
  const rest = (id: string) => {
    state.current.at = id;
    const point = latest.current.hover(id);
    if (!point) return;
    land(point);
    setMotion({ x: point.x, y: point.y });
  };
  const glide = (points: Point[], to: string) => {
    const path = route(points);
    if (latest.current.reduce || !path) {
      state.current.moving = false;
      rest(to);
      return;
    }
    active.current?.value.stopAnimation();
    const value = new Animated.Value(0);
    active.current = { value, path, layoutKey: latest.current.layoutKey };
    state.current.moving = true;
    land(path.points[path.points.length - 1] as Point);
    setMotion({
      x: value.interpolate({ inputRange: path.stops, outputRange: path.points.map((point) => point.x) }),
      y: value.interpolate({ inputRange: path.stops, outputRange: path.points.map((point) => point.y) }),
    });
    Animated.timing(value, {
      toValue: 1,
      duration: glideTime(path.length),
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: NATIVE_DRIVER,
    }).start(({ finished }) => {
      if (!finished || active.current?.value !== value) return;
      state.current.moving = false;
      state.current.at = to;
      // Bursts of reads queue only the newest target, so the cursor lands before it moves on.
      const next = state.current.pending;
      state.current.pending = null;
      if (next && next !== to) go(to, next);
    });
  };
  const go = (from: string, to: string) => {
    const { graph, hover } = latest.current;
    const points = graphPath(graph, from, to).flatMap((id) => {
      const point = hover(id);
      return point ? [point] : [];
    });
    // The start node may have left the graph; then the glide starts where the cursor is.
    const start = state.current.point;
    if (start && (points.length === 0 || hover(from) === null)) points.unshift(start);
    glide(points, to);
  };

  useEffect(() => {
    const current = state.current;
    if (current.at === null) rest(target);
    else if (current.moving) current.pending = target;
    else if (current.at !== target) go(current.at, target);
  }, [target]);

  // Nodes moved: glide from where the cursor is now to where its target is now.
  useEffect(() => {
    const current = state.current;
    const goal = latest.current.target;
    const end = latest.current.hover(goal);
    const glideNow = active.current;
    if (!end) return;
    if (current.moving && glideNow) {
      if (glideNow.layoutKey === props.layoutKey) return;
      current.pending = null;
      glideNow.value.stopAnimation((share) => glide([pointAt(glideNow.path, share), end], goal));
    } else if (current.point && (current.point.x !== end.x || current.point.y !== end.y)) {
      glide([current.point, end], goal);
    }
  }, [props.layoutKey]);

  useEffect(() => () => active.current?.value.stopAnimation(), []);

  const running = agent.running && !reduce;
  useEffect(() => {
    if (!running) {
      bob.setValue(0);
      halo.setValue(0);
      return;
    }
    const float = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(bob, { toValue: 0, duration: 1300, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    const pulse = Animated.loop(
      Animated.timing(halo, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE_DRIVER }),
    );
    float.start();
    pulse.start();
    return () => {
      float.stop();
      pulse.stop();
    };
  }, [running, bob, halo]);

  const satellites = Math.min(MAX_SATELLITES, agent.satellites);
  useEffect(() => {
    if (satellites === 0 || reduce) return;
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 2600, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER }),
    );
    loop.start();
    return () => loop.stop();
  }, [satellites, reduce, spin]);

  const caption = agent.caption ?? (agent.kind === "child" ? agent.label : null);
  const styles = useMemo(() => {
    const half = BADGE / 2;
    return {
      anchor: { position: "absolute", left: 0, top: 0, width: 0, height: 0, opacity: agent.running ? 1 : 0.75 },
      float: { transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }] },
      halo: {
        position: "absolute",
        left: -half - 6,
        top: -half - 6,
        width: BADGE + 12,
        height: BADGE + 12,
        borderRadius: (BADGE + 12) / 2,
        backgroundColor: agent.color,
        opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
        transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.5] }) }],
      },
      badge: {
        position: "absolute",
        left: -half,
        top: -half,
        width: BADGE,
        height: BADGE,
        borderRadius: half,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: agent.color,
        borderWidth: 2,
        borderColor: colors.surface0,
      },
      pointer: {
        position: "absolute",
        left: -5,
        top: half - 1,
        width: 0,
        height: 0,
        borderLeftWidth: 5,
        borderRightWidth: 5,
        borderTopWidth: 7,
        borderLeftColor: "transparent",
        borderRightColor: "transparent",
        borderTopColor: agent.color,
      },
      caption: {
        position: "absolute",
        ...(flip ? { right: half + 6 } : { left: half + 6 }),
        top: -10,
        height: 20,
        maxWidth: 190,
        paddingHorizontal: 8,
        justifyContent: "center",
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
      },
      captionText: { color: colors.foreground, fontSize: 11 },
      orbit: {
        position: "absolute",
        left: -22,
        top: -22,
        width: 44,
        height: 44,
        transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
      },
      moon: {
        position: "absolute",
        width: 8,
        height: 8,
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor: colors.surface0,
        backgroundColor: colors.foregroundMuted,
      },
    } as const;
  }, [agent.color, agent.running, colors, bob, halo, spin, flip]);
  if (!motion) return null;
  const moons = Array.from({ length: satellites }, (_, index) => {
    const angle = (index / Math.max(1, satellites)) * Math.PI * 2;
    return { left: 18 + Math.cos(angle) * 20, top: 18 + Math.sin(angle) * 20 };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.anchor, { transform: [{ translateX: motion.x }, { translateY: motion.y }, { scale: props.inverse }] }]}
    >
      <Animated.View style={styles.float}>
        {agent.running ? <Animated.View style={styles.halo} /> : null}
        {moons.length > 0 ? (
          <Animated.View style={styles.orbit}>
            {moons.map((moon, index) => (
              <View key={index} style={[styles.moon, moon]} />
            ))}
          </Animated.View>
        ) : null}
        <View style={styles.pointer} />
        <View style={styles.badge}>
          {agent.provider ? (
            <ProviderIcon provider={agent.provider} size={13} color={colors.accentForeground} />
          ) : (
            <Icon name="Bot" size={13} color={colors.surface0} />
          )}
        </View>
        {caption ? (
          <View style={styles.caption}>
            <Text numberOfLines={1} style={styles.captionText}>
              {caption}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </Animated.View>
  );
});
