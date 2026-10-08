import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, type GestureResponderHandlers, PanResponder, View } from "react-native";
import { type Box, type Camera, clampCamera, FIT, frameBox, MAX_ZOOM, MIN_ZOOM, zoomAt } from "../shared/graph-camera";
import { NATIVE_DRIVER } from "./live-timeline";
import { ToolButton, ToolGroup } from "./tool-buttons";
import type { Theme } from "./ui";
import { listenWheel } from "./web";

// Animated values move the graph canvas, so a wheel or a drag never renders the graph again.
// Nodes, edges, and cursors scale by the inverse zoom, so they keep their size on screen.

export interface CameraOptions {
  width: number;
  height: number;
  /** Where auto mode looks; null shows the whole graph. */
  focus: Box | null;
  auto: boolean;
  /** Wheel and drag move the page, not the camera. */
  locked: boolean;
  reduce: boolean;
  /** The user moved the camera, so auto mode stops. */
  onManual(): void;
}

type ZoomLimit = "min" | "max" | null;

export interface CameraControl {
  ref: RefObject<View | null>;
  handlers: GestureResponderHandlers;
  transform: [{ translateX: Animated.Value }, { translateY: Animated.Value }, { scale: Animated.Value }];
  /** One over the zoom: the scale that keeps a canvas item its own size on screen. */
  inverse: Animated.AnimatedInterpolation<number>;
  limit: ZoomLimit;
  /** The camera once it stops moving; labels are placed for it. */
  settled: Camera;
  zoomBy(factor: number): void;
  fit(): void;
}

const ZOOM_STEP = 1.5;
const DRAG_START = 6;
const SETTLE_MS = 160;

type Touch = { pageX: number; pageY: number };
const spreadOf = (touches: readonly Touch[]) => {
  const [a, b] = touches;
  return a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : null;
};

export function useGraphCamera(options: CameraOptions): CameraControl {
  const [values] = useState(() => ({ x: new Animated.Value(0), y: new Animated.Value(0), zoom: new Animated.Value(1) }));
  const [inverse] = useState(() => Animated.divide<number>(new Animated.Value(1), values.zoom));
  const [limit, setLimit] = useState<ZoomLimit>("min");
  const [settled, setSettled] = useState<Camera>(FIT);
  const pause = useRef<ReturnType<typeof setTimeout> | null>(null);
  const camera = useRef<Camera>(FIT);
  const ref = useRef<View>(null);
  const latest = useRef(options);
  latest.current = options;

  const apply = useCallback(
    (next: Camera, animate: boolean) => {
      const { width, height, reduce } = latest.current;
      const target = clampCamera(next, width, height);
      camera.current = target;
      setLimit(target.zoom <= MIN_ZOOM ? "min" : target.zoom >= MAX_ZOOM ? "max" : null);
      for (const value of [values.x, values.y, values.zoom]) value.stopAnimation();
      if (pause.current) clearTimeout(pause.current);
      if (!animate || reduce) {
        values.x.setValue(target.x);
        values.y.setValue(target.y);
        values.zoom.setValue(target.zoom);
        pause.current = setTimeout(() => setSettled(target), SETTLE_MS);
        return;
      }
      const glide = (value: Animated.Value, toValue: number) =>
        Animated.timing(value, { toValue, duration: 450, easing: Easing.inOut(Easing.cubic), useNativeDriver: NATIVE_DRIVER });
      Animated.parallel([glide(values.x, target.x), glide(values.y, target.y), glide(values.zoom, target.zoom)]).start(
        ({ finished }) => {
          if (finished) setSettled(target);
        },
      );
    },
    [values],
  );
  const move = useCallback(
    (next: Camera, animate: boolean) => {
      if (latest.current.auto) latest.current.onManual();
      apply(next, animate);
    },
    [apply],
  );

  useEffect(
    () => () => {
      if (pause.current) clearTimeout(pause.current);
    },
    [],
  );

  const { width, height, auto, locked, focus } = options;
  const focusKey = focus ? [focus.left, focus.top, focus.right, focus.bottom].map(Math.round).join(",") : "";
  useEffect(() => {
    if (width === 0 || !auto) return;
    const box = latest.current.focus;
    apply(box ? frameBox(box, width, height) : FIT, true);
  }, [auto, focusKey, width, height, apply]);
  useEffect(() => {
    if (width > 0 && !latest.current.auto) apply(camera.current, false);
  }, [width, height, apply]);

  useEffect(() => {
    if (locked) return;
    return listenWheel(ref.current, (point, factor) => {
      const size = latest.current;
      move(zoomAt(camera.current, point, factor, size.width, size.height), false);
    });
  }, [locked, move]);

  // A drag pans once zoomed in; at full view it scrolls the page. Two fingers pinch to zoom.
  const handlers = useMemo(() => {
    let start = FIT;
    let origin = { x: 0, y: 0 };
    let fingers = 0;
    let spread: number | null = null;
    let lead = { x: 0, y: 0 };
    const follow = (touches: readonly Touch[], gesture: { dx: number; dy: number }) => {
      if (Math.min(2, touches.length) !== fingers) {
        fingers = Math.min(2, touches.length);
        start = camera.current;
        origin = { x: gesture.dx, y: gesture.dy };
        spread = spreadOf(touches);
      }
      const { width: w, height: h } = latest.current;
      const now = spreadOf(touches);
      const base = now && spread ? zoomAt(start, { x: w / 2, y: h / 2 }, now / spread, w, h) : start;
      move({ ...base, x: base.x + gesture.dx - origin.x, y: base.y + gesture.dy - origin.y }, false);
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => {
        if (latest.current.locked) return false;
        lead = { x: gesture.dx, y: gesture.dy };
        if (gesture.numberActiveTouches >= 2) return true;
        return camera.current.zoom > MIN_ZOOM && Math.hypot(gesture.dx, gesture.dy) > DRAG_START;
      },
      // The grant restarts dx at zero, so the move before it is added back.
      onPanResponderGrant: (event) => {
        const touches = event.nativeEvent.touches;
        fingers = Math.min(2, touches.length);
        start = camera.current;
        origin = { x: -lead.x, y: -lead.y };
        spread = spreadOf(touches);
      },
      onPanResponderMove: (event, gesture) => follow(event.nativeEvent.touches, gesture),
      onPanResponderTerminationRequest: () => false,
    }).panHandlers;
  }, [move]);

  const transform = useMemo(
    (): CameraControl["transform"] => [{ translateX: values.x }, { translateY: values.y }, { scale: values.zoom }],
    [values],
  );
  const zoomBy = useCallback(
    (factor: number) => {
      const size = latest.current;
      move(zoomAt(camera.current, { x: size.width / 2, y: size.height / 2 }, factor, size.width, size.height), true);
    },
    [move],
  );
  const fit = useCallback(() => move(FIT, true), [move]);
  return { ref, handlers, transform, inverse, limit, settled, zoomBy, fit };
}

export function CameraButtons(props: {
  theme: Theme;
  camera: CameraControl;
  auto: boolean;
  locked: boolean;
  onAuto(): void;
  onLock(): void;
}) {
  const { theme, camera, auto, locked } = props;
  const style = useMemo(() => ({ position: "absolute", top: 8, right: 8 }) as const, []);
  return (
    <View style={style}>
      <ToolGroup theme={theme}>
        <ToolButton
          theme={theme}
          icon="LocateFixed"
          label={auto ? "Stop following the running agents" : "Follow the running agents"}
          active={auto}
          onPress={props.onAuto}
        />
        <ToolButton theme={theme} icon="Maximize" label="Show the whole graph" onPress={camera.fit} />
        <ToolButton
          theme={theme}
          icon="Minus"
          label="Zoom out"
          disabled={camera.limit === "min"}
          onPress={() => camera.zoomBy(1 / ZOOM_STEP)}
        />
        <ToolButton
          theme={theme}
          icon="Plus"
          label="Zoom in"
          disabled={camera.limit === "max"}
          onPress={() => camera.zoomBy(ZOOM_STEP)}
        />
        <ToolButton
          theme={theme}
          icon={locked ? "Lock" : "LockOpen"}
          label={locked ? "Let the wheel and drags move the graph" : "Let the wheel and drags scroll the page"}
          active={locked}
          onPress={props.onLock}
        />
      </ToolGroup>
    </View>
  );
}
