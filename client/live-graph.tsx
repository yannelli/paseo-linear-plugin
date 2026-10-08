import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from "react-native";
import { focusBox, project, unproject } from "../shared/graph-camera";
import type { Placed, Point } from "../shared/graph-geometry";
import { focusNode, type Graph, type GraphEdge, type GraphNode, graphKey, layoutGraph } from "../shared/graph-model";
import { type AreaRef, whereLabel } from "../shared/knowledge";
import type { IssueDetail, WorkflowState } from "../shared/linear";
import type { GraphCamera } from "../shared/settings";
import { CameraButtons, useGraphCamera } from "./graph-camera";
import { captionWidth, graphLabels, HOVER_GAP, type Label, nodeSize } from "./graph-labels";
import type { CursorAgent } from "./live-agents";
import { AgentCursor, CAPTION_ROOM } from "./live-cursor";
import { type IssueProgress, MONO } from "./live-issues";
import type { LivePatch } from "./live-panel";
import { NATIVE_DRIVER, type OwnerColors } from "./live-timeline";
import { StateIcon, type Theme } from "./ui";

// Edges are thin Views rotated to their angle, since plugins have no SVG. Each layout starts
// from the last one, so nodes stay put as files arrive and an agent glides between them.

export interface GraphViewProps {
  theme: Theme;
  compact: boolean;
  /** The issues column is collapsed, so the graph can use more height. */
  full: boolean;
  graph: Graph;
  /** The links between files have loaded at least once. */
  ready: boolean;
  issue: IssueDetail;
  progress: IssueProgress;
  owners: OwnerColors;
  agents: readonly CursorAgent[];
  /** Areas of the project, to say where an off-map file is. */
  areas: readonly AreaRef[];
  focus: string | null;
  onFocus(key: string): void;
  /** Saved camera mode: follow the running agents, or show the whole graph. */
  camera: GraphCamera;
  locked: boolean;
  saveLive(patch: LivePatch): void;
  reduceMotion: boolean;
}

type Inverse = Animated.AnimatedInterpolation<number>;
/** About half the height of a folder name, which scales around its middle. */
const FOLDER_HALF = 7;

interface EdgeStyle {
  color: string;
  thickness: number;
  opacity: number;
}

interface EdgeProps {
  from: Point;
  to: Point;
  style: EdgeStyle;
  inverse: Inverse;
}

const EdgeLine = memo(function EdgeLine(props: EdgeProps) {
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
    // Rotate first, so the inverse zoom thins the line and leaves its length to the camera.
    transform: [{ rotate: `${angle}rad` }, { scaleY: props.inverse }],
  } as const;
  return <Animated.View pointerEvents="none" style={line} />;
}, sameEdge);

function sameEdge(a: EdgeProps, b: EdgeProps) {
  return (
    a.inverse === b.inverse &&
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
  inverse: Inverse;
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
    a.inverse === b.inverse &&
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
        transform: [{ scale: props.inverse }],
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
  }, [node, size, at, color, colors, touched, label, props.dim, props.selected, props.current, props.inverse, enter, beat]);
  const press = useCallback(() => props.onPress(node.id), [props.onPress, node.id]);
  return (
    <Animated.View style={styles.wrap} pointerEvents="box-none">
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
    </Animated.View>
  );
}, sameNode);

function caption(node: GraphNode, issue: IssueDetail, graph: Graph, areas: readonly AreaRef[]): string {
  if (node.kind === "issue") return `${issue.identifier} · ${issue.title}`;
  if (node.kind === "subissue") {
    const child = issue.children.find((entry) => entry.identifier.toUpperCase() === node.label);
    const folded = node.folded > 0 ? ` · ${node.folded} more files not shown` : "";
    return `${node.label} · ${child?.state.name ?? ""} · ${child?.title ?? ""}${folded}`;
  }
  const tile = node.tile;
  const where = tile?.onMap ? `on the map for ${node.owner}` : `not on the map, in ${whereLabel(node.path ?? "", areas)}`;
  const touch = !tile || tile.touch === "none" ? "not touched yet" : tile.touch;
  const lines = tile && (tile.added > 0 || tile.removed > 0) ? ` · +${tile.added} -${tile.removed}` : "";
  const linked = graph.edges.filter((edge) => edge.kind !== "owns" && (edge.from === node.id || edge.to === node.id)).length;
  const links = linked > 0 ? ` · ${linked} linked ${linked === 1 ? "file" : "files"}` : "";
  return `${node.path} · ${touch} · ${where}${links}${lines}`;
}

export function LiveGraph(props: GraphViewProps) {
  const { theme, graph, owners, focus, issue, progress, ready } = props;
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
  const shown = ready && width > 0;
  const layoutKey = `${graphKey(graph)}@${width}x${height}`;
  const previous = useRef<ReadonlyMap<string, Placed>>(new Map());
  // The layout depends only on the nodes, edges, and size; graph changes on every timeline update.
  const positions = useMemo(() => {
    if (!shown) return new Map<string, Placed>();
    const next = layoutGraph(graph, width, height, previous.current);
    previous.current = next;
    return next;
  }, [layoutKey, shown]);
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const states = useMemo(() => {
    const map = new Map<string, WorkflowState>([[graph.root, issue.state]]);
    for (const child of issue.children) map.set(`sub:${child.identifier.toUpperCase()}`, child.state);
    return map;
  }, [graph.root, issue]);
  const targets = useMemo(
    () =>
      props.agents.map((agent) => {
        const target = focusNode(graph, agent.focus);
        // A child agent whose file is off the graph hovers over the issue it works on.
        return { agent, target: target === graph.root && agent.home ? focusNode(graph, agent.home) : target };
      }),
    [props.agents, graph],
  );
  const working = useMemo(
    () => new Set(targets.filter(({ agent }) => agent.running).map(({ target }) => target)),
    [targets],
  );
  // The edges at the node a running agent works on take its color.
  const trail = useMemo(() => {
    const lit = new Map<string, string>();
    const colorOf = new Map(targets.filter(({ agent }) => agent.running).map(({ agent, target }) => [target, agent.color]));
    for (const edge of graph.edges) {
      const color = colorOf.get(edge.from) ?? colorOf.get(edge.to);
      if (color) lit.set(edge.id, color);
    }
    return lit;
  }, [targets, graph.edges]);
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
    const a = byId.get(edge.from);
    const b = byId.get(edge.to);
    const lit = trail.get(edge.id);
    if (lit) return { color: lit, thickness: 2.5, opacity: 0.9 };
    const faded = dimmed(a) || dimmed(b) ? 0.3 : 1;
    if (edge.kind === "owns") {
      const file = a?.kind === "file" ? a : b?.kind === "file" ? b : undefined;
      const sub = a?.kind === "subissue" ? a : b;
      if (file) return { color: nodeColor(file), thickness: 1, opacity: 0.28 * faded };
      return { color: sub ? nodeColor(sub) : colors.border, thickness: 1.5, opacity: 0.55 };
    }
    const shared = a?.owner && a.owner === b?.owner ? nodeColor(a) : colors.foregroundMuted;
    if (edge.kind === "import") return { color: shared, thickness: 1.2, opacity: 0.55 * faded };
    if (edge.kind === "link") return { color: shared, thickness: 1, opacity: 0.4 * faded };
    return { color: colors.foregroundMuted, thickness: 0.8, opacity: 0.25 * faded };
  };
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
  const cursors = useMemo(
    () =>
      targets.flatMap(({ agent, target }) => {
        const at = hovers.get(agent.id)?.(target);
        if (!at) return [];
        const text = agent.caption ?? (agent.kind === "child" ? agent.label : null);
        return [{ at, caption: captionWidth(text), flip: at.x > width - CAPTION_ROOM }];
      }),
    [targets, hovers, width],
  );
  const { saveLive } = props;
  const [auto, setAuto] = useState(props.camera === "auto");
  const [locked, setLocked] = useState(props.locked);
  const stopAuto = useCallback(() => {
    setAuto(false);
    saveLive({ graphCamera: "fit" });
  }, [saveLive]);
  const toggleAuto = useCallback(() => {
    setAuto(!auto);
    saveLive({ graphCamera: auto ? "fit" : "auto" });
  }, [auto, saveLive]);
  const toggleLock = useCallback(() => {
    setLocked(!locked);
    saveLive({ graphLocked: !locked });
  }, [locked, saveLive]);
  const box = useMemo(() => focusBox(graph, positions, working), [graph, positions, working]);
  const camera = useGraphCamera({ width, height, focus: box, auto, locked, reduce: props.reduceMotion, onManual: stopAuto });
  // Labels are placed in the view of the settled camera, then moved back onto the canvas.
  const view = camera.settled;
  const labels = useMemo(() => {
    if (view.zoom === 1) return graphLabels({ graph, positions, issue, progress, selected, working, cursors, width, height });
    const toView = (at: Point) => project(view, at, width, height);
    const seen = new Map<string, Placed>();
    for (const [id, at] of positions) {
      const shown = toView(at);
      if (shown.x > -20 && shown.x < width + 20 && shown.y > -20 && shown.y < height + 20) seen.set(id, { ...at, ...shown });
    }
    const viewCursors = cursors.map((cursor) => ({ ...cursor, at: toView(cursor.at) }));
    const placed = graphLabels({ graph, positions: seen, issue, progress, selected, working, cursors: viewCursors, width, height, every: view.zoom >= 1.5 });
    const nodes = new Map<string, Label>();
    for (const [id, label] of placed.nodes) {
      const at = positions.get(id);
      const shown = seen.get(id);
      if (at && shown) nodes.set(id, { ...label, left: label.left + at.x - shown.x, top: label.top + at.y - shown.y });
    }
    const folders = placed.folders.map((folder) => {
      const middle = unproject(view, { x: folder.left + folder.width / 2, y: folder.top + FOLDER_HALF }, width, height);
      return { ...folder, left: middle.x - folder.width / 2, top: middle.y - FOLDER_HALF };
    });
    return { nodes, folders };
  }, [graph.nodes, positions, issue, progress, selected, working, cursors, width, height, view]);
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
        world: { ...StyleSheet.absoluteFillObject, transform: camera.transform },
        waiting: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
        waitingText: { color: colors.foregroundMuted, fontSize: 12 },
        folder: { position: "absolute", color: colors.foregroundMuted, fontFamily: MONO, fontSize: 10, opacity: 0.75 },
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
    [height, colors, camera.transform],
  );
  const selectedNode = selected ? byId.get(selected) : undefined;
  const ordered = [...graph.edges].sort((a, b) => Number(trail.has(a.id)) - Number(trail.has(b.id)));
  return (
    <View>
      <View ref={camera.ref} style={styles.canvas} onLayout={measure} {...camera.handlers}>
        <Animated.View pointerEvents="box-none" style={styles.world}>
          {shown
            ? ordered.map((edge) => {
                const from = positions.get(edge.from);
                const to = positions.get(edge.to);
                if (!from || !to) return null;
                return <EdgeLine key={edge.id} from={from} to={to} style={edgeStyle(edge)} inverse={camera.inverse} />;
              })
            : null}
          {shown
            ? labels.folders.map((folder) => (
                <Animated.Text
                  key={folder.folder}
                  pointerEvents="none"
                  numberOfLines={1}
                  style={[
                    styles.folder,
                    { left: folder.left, top: folder.top, width: folder.width, transform: [{ scale: camera.inverse }] },
                  ]}
                >
                  {folder.folder === "." ? "/" : `${folder.folder}/`}
                </Animated.Text>
              ))
            : null}
          {shown
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
                    label={labels.nodes.get(node.id) ?? null}
                    inverse={camera.inverse}
                    reduce={props.reduceMotion}
                    onPress={press}
                  />
                );
              })
            : null}
          {shown
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
                    inverse={camera.inverse}
                    reduce={props.reduceMotion}
                  />
                );
              })
            : null}
        </Animated.View>
        {!ready ? (
          <View style={styles.waiting}>
            <Text style={styles.waitingText}>Linking files…</Text>
          </View>
        ) : null}
        {shown ? (
          <CameraButtons
            theme={theme}
            camera={camera}
            auto={auto}
            locked={locked}
            onAuto={toggleAuto}
            onLock={toggleLock}
          />
        ) : null}
      </View>
      <View style={styles.caption}>
        {selectedNode ? (
          <Text numberOfLines={2} style={styles.captionText}>
            {caption(selectedNode, issue, graph, props.areas)}
          </Text>
        ) : (
          <Text style={styles.hint}>Select a node to see its file or issue.</Text>
        )}
      </View>
    </View>
  );
}
