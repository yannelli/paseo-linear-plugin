import { Platform } from "react-native";

// The only module that uses the DOM. Off the web each export does nothing.
// The file picker is a hidden file input, because plugins cannot use native document pickers.
// Local storage keeps small values for the next start; it can be missing or blocked.

interface FileLike {
  name: string;
  size: number;
  text(): Promise<string>;
}

interface FileInputLike {
  type: string;
  accept: string;
  files: ArrayLike<FileLike> | null;
  onchange: (() => void) | null;
  click(): void;
}

interface DocumentLike {
  createElement(tag: "input"): FileInputLike;
}

/** True where pickTextFile can open a file picker. */
export const canPickFiles = Platform.OS === "web";

export type PickedFile = { name: string; text: string } | { error: string };

/** Opens the browser file picker and calls onPick with the chosen file. Nothing on cancel. */
export function pickTextFile(accept: string, maxBytes: number, onPick: (file: PickedFile) => void): void {
  const document = (globalThis as { document?: DocumentLike }).document;
  if (!canPickFiles || !document) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > maxBytes) {
      onPick({ error: `${file.name} is too large. Use a file under ${Math.round(maxBytes / 1000)} KB.` });
      return;
    }
    file.text().then(
      (text) => onPick({ name: file.name, text }),
      () => onPick({ error: `Paseo could not read ${file.name}.` }),
    );
  };
  input.click();
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function storage(): StorageLike | null {
  if (Platform.OS !== "web") return null;
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** A value saved on this device, or null off the web or when storage is blocked. */
export function readStored(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string): void {
  try {
    storage()?.setItem(key, value);
  } catch {
    // Blocked storage only means the next start uses the built-in icon first.
  }
}
