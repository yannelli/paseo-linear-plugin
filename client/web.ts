import { Platform } from "react-native";

// The only module that uses the DOM. React wheel listeners are passive, so they cannot keep
// the page from scrolling while the wheel zooms the graph. Off the web each export does nothing.

interface WheelEventLike {
  deltaY: number;
  deltaMode: number;
  clientX: number;
  clientY: number;
  preventDefault(): void;
}

type WheelListener = (event: WheelEventLike) => void;

interface ElementLike {
  addEventListener(type: "wheel", listener: WheelListener, options: { passive: boolean }): void;
  removeEventListener(type: "wheel", listener: WheelListener): void;
  getBoundingClientRect(): { left: number; top: number };
}

function isElement(node: unknown): node is ElementLike {
  if (typeof node !== "object" || node === null) return false;
  const element = node as Partial<ElementLike>;
  return typeof element.addEventListener === "function" && typeof element.getBoundingClientRect === "function";
}

const LINE = 16;
const PAGE = 400;

/** Calls onWheel with the point under the pointer and a zoom factor. Returns the cleanup. */
export function listenWheel(
  node: unknown,
  onWheel: (point: { x: number; y: number }, factor: number) => void,
): () => void {
  if (Platform.OS !== "web" || !isElement(node)) return () => {};
  const listener: WheelListener = (event) => {
    event.preventDefault();
    const rect = node.getBoundingClientRect();
    const pixels = event.deltaY * (event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? PAGE : 1);
    onWheel({ x: event.clientX - rect.left, y: event.clientY - rect.top }, Math.exp(-pixels * 0.002));
  };
  node.addEventListener("wheel", listener, { passive: false });
  return () => node.removeEventListener("wheel", listener);
}
