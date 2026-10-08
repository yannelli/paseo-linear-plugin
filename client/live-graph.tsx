import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Animated, type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import {
  focusNode,
  type Graph,
  type GraphEdge,
  type GraphNode,
  graphKey,
  type LabelRequest,
  labelBox,
  labelSides,
  type Placed,
  type Point,
  placeLabels,
  treeLayout,
  treePath,
} from "../shared/graph-model";
import type { IssueDetail, WorkflowState } from "../shared/linear";
import { todoStatus } from "../shared/todo-sync";
import type { CursorAgent } from "./live-agents";
import { AgentCursor } from "./live-cursor";
import { type IssueProgress, MONO } from "./live-issues";
import { NATIVE_DRIVER, type OwnerColors } from "./live-timeline";
import { StateIcon, type Theme } from "./ui";

// Edges are thin Views rotated to their angle, since plugins have no SVG. The layout comes
// from the tree alone, so a node keeps its place and an agent can glide between fixed points.

const SIZES = { issue: 46, subissue: 32 } as const;
const HOVER_GAP = 22;

export interface GraphViewProps {
  theme: Theme;
  compact: boolean;
  /** The issues column is collapsed, so the graph can use more height. */
  full: boolean;
  graph: Graph;
  issue: IssueDetail;
  progress: IssueProgress;
  owners: OwnerColors;
  agents: readonly CursorAgent[];
  focus: string | null;
  onFocus(key: string): void;
  reduceMotion: boolean;
}

function nodeSize(node: GraphNode): number {
  if (node.kind !== "file") return SIZES[node.kind];
  const touched = node.tile && node.tile.touch !== "none";
  return touched ? (node.tile?.touch === "read" ? 12 : 14) : 9;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

interface Label {
  left: number;
  top: number;
  width: number;
  lines: readonly [string, string | null];
}

interface EdgeStyle {
  color: string;
  thickness: number;
  opacity: number;
}

const EdgeLine = memo(function EdgeLine(props: { from: Point; to: Point; style: EdgeStyle }) {
  const { from, to, style } = props;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const line = {
    position: "absolute",
    left: (from.x + to.x) / 2 - length / 2,
    top: (from.y + to.y) / 2 - style.thickness / 2,
    width: length,
    height: style.thickness,
    borderRadius: style.thickness / 2,
    backgroundColor: style.color,
    opacity: style.opacity,
    transform: [{ rotate: `${angle}rad` }],
  } as const;
  return <View pointerEvents="none" style={line} />;
}, sameEdge);

function sameEdge(a: { from: Point; to: Point; style: EdgeStyle }, b: { from: Point; to: Point; style: EdgeStyle }) {
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.style.color === b.style.color &&
    a.style.thickness === b.style.thickness &&
    a.style.opacity === b.style.opacity
  );
}

interface NodeProps {
  theme: Theme;
  node: GraphNode;
  at: Placed;
  color: string;
  state: WorkflowState | null;
  dim: boolean;
  selected: boolean;
  /** An agent is working on it. */
  current: boolean;
  label: Label | null;
  reduce: boolean;
  onPress(id: string): void;
}

// Nodes are rebuilt on every timeline update; only these fields change how one looks.
function sameNode(a: NodeProps, b: NodeProps): boolean {
  const x = a.node;
  const y = b.node;
  return (
    a.at === b.at &&
    a.color === b.color &&
    a.state === b.state &&
    a.dim === b.dim &&
    a.selected === b.selected &&
    a.current === b.current &&
    a.label?.left === b.label?.left &&
    a.label?.top === b.label?.top &&
    a.label?.lines[0] === b.label?.lines[0] &&
    a.label?.lines[1] === b.label?.lines[1] &&
    a.theme === b.theme &&
    a.reduce === b.reduce &&
    a.onPress === b.onPress &&
    x.id === y.id &&
    x.owner === y.owner &&
    x.tile?.touch === y.tile?.touch
  );
}

const GraphNodeView = memo(function GraphNodeView(props: NodeProps) {
  const { theme, node, at, color, label } = props;
  const { colors } = theme;
  const size = nodeSize(node);
  const [enter] = useState(() => new Animated.Value(props.reduce ? 1 : 0));
  const [beat] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (props.reduce) return;
    const animation = Animated.spring(enter, { toValue: 1, friction: 6, tension: 120, useNativeDriver: NATIVE_DRIVER });
    animation.start();
    return () => animation.stop();
  }, [enter, props.reduce]);
  useEffect(() => {
    if (!props.current || props.reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beat, { toValue: 1.3, duration: 550, useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(beat, { toValue: 1, duration: 550, useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      beat.setValue(1);
    };
  }, [props.current, props.reduce, beat]);
  const touched = node.kind === "file" && node.tile !== null && node.tile.touch !== "none";
  const styles = useMemo(() => {
    const unplanned = node.kind === "file" && touched && !node.tile?.onMap;
    const tone = unplanned ? colors.statusWarning : color;
    const align = label && at.side === "left" ? "right" : label && at.side === "right" ? "left" : "center";
    return {
      wrap: {
        position: "absolute",
        left: at.x - size / 2,
        top: at.y - size / 2,
        width: size,
        height: size,
        opacity: props.dim ? 0.22 : 1,
      },
      shape: {
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: node.kind === "file" ? 1.5 : 2,
        borderColor: props.selected ? colors.foreground : props.current ? colors.accent : tone,
        backgroundColor: touched ? tone : node.kind === "file" ? "transparent" : colors.surface1,
        transform: [{ scale: Animated.multiply(enter, beat) }],
        opacity: enter,
      },
      tint: { ...StyleSheet.absoluteFillObject, borderRadius: size / 2, backgroundColor: tone, opacity: 0.2 },
      label: label
        ? {
            position: "absolute" as const,
            left: label.left - (at.x - size / 2),
            top: label.top - (at.y - size / 2),
            width: label.width,
          }
        : {},
      first: {
        color: node.kind === "file" && !props.selected ? colors.foregroundMuted : colors.foreground,
        fontFamily: MONO,
        fontSize: node.kind === "issue" ? 12 : 10,
        fontWeight: node.kind === "file" ? "400" : "700",
        textAlign: align,
      },
      second: { color: colors.foregroundMuted, fontSize: 10, textAlign: align },
    } as const;
  }, [node, size, at, color, colors, touched, label, props.dim, props.selected, props.current, enter, beat]);
  const press = useCallback(() => props.onPress(node.id), [props.onPress, node.id]);
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable accessibilityRole="button" accessibilityLabel={node.path ?? node.label} hitSlop={8} onPress={press}>
        <Animated.View style={styles.shape}>
          {node.kind !== "file" ? <View style={styles.tint} /> : null}
          {props.state ? <StateIcon state={props.state} size={node.kind === "issue" ? 18 : 14} /> : null}
        </Animated.View>
      </Pressable>
      {label ? (
        <View style={styles.label} pointerEvents="none">
          <Text numberOfLines={1} style={styles.first}>
            {label.lines[0]}
          </Text>
          {label.lines[1] ? (
            <Text numberOfLines={1} style={styles.second}>
              {label.lines[1]}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}, sameNode);

function caption(node: GraphNode, issue: IssueDetail): string {
  if (node.kind === "issue") return `${issue.identifier} · ${issue.title}`;
  if (node.kind === "subissue") {
    const child = issue.children.find((entry) => entry.identifier.toUpperCase() === node.label);
    const folded = node.folded > 0 ? ` · ${node.folded} more files not shown` : "";
    return `${node.label} · ${child?.state.name ?? ""} · ${child?.title ?? ""}${folded}`;
  }
  const tile = node.tile;
  const where = tile?.onMap ? `on the map for ${node.owner}` : "not on the map";
  const touch = !tile || tile.touch === "none" ? "not touched yet" : tile.touch;
  const lines = tile && (tile.added > 0 || tile.removed > 0) ? ` · +${tile.added} -${tile.removed}` : "";
  return `${node.path} · ${touch} · ${where}${lines}`;
}

export function LiveGraph(props: GraphViewProps) {
  const { theme, graph, owners, focus, issue, progress } = props;
  const { colors } = theme;
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const measure = useCallback((event: LayoutChangeEvent) => {
    setWidth(Math.round(event.nativeEvent.layout.width));
  }, []);
  const count = graph.nodes.length;
  const height = props.compact
    ? 440
    : props.full
      ? Math.min(820, Math.max(560, 360 + count * 5))
      : Math.min(680, Math.max(460, 300 + count * 4));
  const key = graphKey(graph);
  const layoutKey = `${key}@${width}x${height}`;
  // The layout depends only on the tree and the size; graph changes on every timeline update.
  const positions = useMemo(() => treeLayout(graph, width, height), [layoutKey]);
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const states = useMemo(() => {
    const map = new Map<string, WorkflowState>([[graph.root, issue.state]]);
    for (const child of issue.children) map.set(`sub:${child.identifier.toUpperCase()}`, child.state);
    return map;
  }, [graph.root, issue]);
  const targets = useMemo(
    () => props.agents.map((agent) => ({ agent, target: focusNode(graph, agent.focus) })),
    [props.agents, graph],
  );
  const working = useMemo(
    () => new Set(targets.filter(({ agent }) => agent.running).map(({ target }) => target)),
    [targets],
  );
  // The edges from the issue down to what each running agent works on take its color.
  const trail = useMemo(() => {
    const lit = new Map<string, string>();
    for (const { agent, target } of targets) {
      if (!agent.running) continue;
      const path = treePath(graph, graph.root, target);
      path.slice(1).forEach((id, index) => lit.set(`${path[index]}>${id}`, agent.color));
    }
    return lit;
  }, [targets, graph]);
  const nodeColor = useCallback(
    (node: GraphNode) => (node.owner ? owners.get(node.owner.toUpperCase()) : undefined) ?? colors.foregroundMuted,
    [owners, colors.foregroundMuted],
  );
  const dimmed = useCallback(
    (node: GraphNode | undefined) =>
      focus !== null && node !== undefined && node.kind === "file" && node.owner?.toUpperCase() !== focus,
    [focus],
  );
  const edgeStyle = (edge: GraphEdge): EdgeStyle => {
    const to = byId.get(edge.to);
    const faded = dimmed(to) ? 0.25 : 1;
    const lit = trail.get(edge.id);
    if (lit) return { color: lit, thickness: 2.5, opacity: 0.9 * faded };
    if (to?.kind === "subissue") return { color: nodeColor(to), thickness: 1.5, opacity: 0.55 };
    const touched = to?.tile && to.tile.touch !== "none";
    if (!touched || !to) return { color: colors.border, thickness: 1, opacity: 0.9 * faded };
    const color = to.tile?.onMap ? nodeColor(to) : colors.statusWarning;
    return { color, thickness: 1.2, opacity: 0.6 * faded };
  };
  const labels = useMemo(() => {
    const children = new Map(issue.children.map((child) => [child.identifier.toUpperCase(), child]));
    const linesOf = (node: GraphNode): readonly [string, string | null] => {
      if (node.kind === "issue") return [node.label, clip(issue.title, 34)];
      if (node.kind === "file") return [node.label, null];
      const todos = progress.groups.get(node.label) ?? [];
      const done = todos.filter((todo) => todoStatus(todo) === "completed").length;
      const counts = todos.length > 0 ? `  ${done}/${todos.length}` : "";
      const folded = node.folded > 0 ? `  +${node.folded}` : "";
      return [`${node.label}${counts}${folded}`, clip(children.get(node.label)?.title ?? "", 26)];
    };
    const order = (node: GraphNode) =>
      node.id === selected ? 0 : node.kind === "issue" ? 1 : node.kind === "subissue" ? 2 : working.has(node.id) ? 3 : 5;
    const wanted = graph.nodes.filter(
      (node) =>
        node.kind !== "file" || node.id === selected || working.has(node.id) || (node.tile !== null && node.tile.touch !== "none"),
    );
    const lines = new Map<string, readonly [string, string | null]>();
    const requests: LabelRequest[] = [];
    for (const node of [...wanted].sort((a, b) => order(a) - order(b))) {
      const at = positions.get(node.id);
      if (!at) continue;
      const text = linesOf(node);
      const wide = Math.max(text[0].length * (node.kind === "issue" ? 7.4 : 6.2), (text[1]?.length ?? 0) * 5.6);
      const box = { width: Math.min(170, wide + 4), height: text[1] ? 28 : 14 };
      lines.set(node.id, text);
      const spotsFor = (w: number, h: number) =>
        labelSides(at.side).map((side) => labelBox({ ...at, side }, nodeSize(node) / 2, w, h));
      const short = text[1] ? Math.min(170, text[0].length * (node.kind === "issue" ? 7.4 : 6.2) + 4) : 0;
      requests.push({
        id: node.id,
        ...box,
        spots: spotsFor(box.width, box.height),
        fallback: text[1] ? { width: short, height: 14, spots: spotsFor(short, 14) } : undefined,
      });
    }
    const shapes: { at: Point; radius: number }[] = graph.nodes.flatMap((node) => {
      const at = positions.get(node.id);
      return at ? [{ at, radius: nodeSize(node) / 2 }] : [];
    });
    // Keep labels out from under the agents hovering over their nodes.
    for (const target of new Set(targets.map((entry) => entry.target))) {
      const at = positions.get(target);
      const node = byId.get(target);
      if (at && node) shapes.push({ at: { x: at.x, y: at.y - nodeSize(node) / 2 - HOVER_GAP }, radius: 16 });
    }
    const shown = new Map<string, Label>();
    const widths = new Map(requests.map((request) => [request.id, request.width]));
    const fallbacks = new Map(requests.map((request) => [request.id, request.fallback?.width ?? 0]));
    for (const [id, box] of placeLabels(requests, width, height, shapes)) {
      const text = lines.get(id) ?? ["", null];
      shown.set(id, {
        left: box.left,
        top: box.top,
        width: (box.short ? fallbacks.get(id) : widths.get(id)) ?? 0,
        lines: box.short ? [text[0], null] : text,
      });
    }
    return shown;
  }, [graph.nodes, positions, selected, working, targets, byId, width, height, issue, progress]);
  // Agents on the same node hover side by side.
  const hovers = useMemo(() => {
    const seen = new Map<string, number>();
    return new Map(
      targets.map(({ agent, target }) => {
        const slot = seen.get(target) ?? 0;
        seen.set(target, slot + 1);
        const hover = (id: string): Point | null => {
          const at = positions.get(id);
          const node = byId.get(id);
          if (!at || !node) return null;
          return { x: at.x + slot * 30, y: at.y - nodeSize(node) / 2 - HOVER_GAP };
        };
        return [agent.id, hover] as const;
      }),
    );
  }, [targets, positions, byId]);
  const press = useCallback(
    (id: string) => {
      setSelected((current) => (current === id ? null : id));
      const node = byId.get(id);
      if (node?.kind === "subissue" || node?.kind === "issue") props.onFocus(node.label.toUpperCase());
    },
    [byId, props.onFocus],
  );
  const styles = useMemo(
    () =>
      ({
        canvas: { height, width: "100%", overflow: "hidden" },
        caption: {
          minHeight: 32,
          marginTop: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderRadius: 8,
          backgroundColor: colors.surface1,
        },
        captionText: { color: colors.foreground, fontSize: 12, fontFamily: MONO },
        hint: { color: colors.foregroundMuted, fontSize: 12 },
      }) as const,
    [height, colors],
  );
  const selectedNode = selected ? byId.get(selected) : undefined;
  const ordered = [...graph.edges].sort((a, b) => Number(trail.has(a.id)) - Number(trail.has(b.id)));
  return (
    <View>
      <View style={styles.canvas} onLayout={measure}>
        {width > 0
          ? ordered.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) return null;
              return <EdgeLine key={edge.id} from={from} to={to} style={edgeStyle(edge)} />;
            })
          : null}
        {width > 0
          ? graph.nodes.map((node) => {
              const at = positions.get(node.id);
              if (!at) return null;
              return (
                <GraphNodeView
                  key={node.id}
                  theme={theme}
                  node={node}
                  at={at}
                  color={nodeColor(node)}
                  state={states.get(node.id) ?? null}
                  dim={dimmed(node)}
                  selected={selected === node.id}
                  current={working.has(node.id)}
                  label={labels.get(node.id) ?? null}
                  reduce={props.reduceMotion}
                  onPress={press}
                />
              );
            })
          : null}
        {width > 0
          ? targets.map(({ agent, target }) => {
              const hover = hovers.get(agent.id);
              if (!hover) return null;
              return (
                <AgentCursor
                  key={agent.id}
                  theme={theme}
                  agent={agent}
                  graph={graph}
                  target={target}
                  layoutKey={layoutKey}
                  hover={hover}
                  width={width}
                  reduce={props.reduceMotion}
                />
              );
            })
          : null}
      </View>
      <View style={styles.caption}>
        {selectedNode ? (
          <Text numberOfLines={2} style={styles.captionText}>
            {caption(selectedNode, issue)}
          </Text>
        ) : (
          <Text style={styles.hint}>Select a node to see its file or issue.</Text>
        )}
      </View>
    </View>
  );
}
