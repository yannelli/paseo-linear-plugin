import { z } from "zod";

// The user's own plugin icon. The web app draws it as an image, which never runs scripts or
// loads files; the checks below also refuse such content. Paint recolors every visible pixel,
// and Solid fills shapes that only have an outline.

export const ICON_PAINTS = ["original", "theme", "accent", "linear", "custom"] as const;
export type IconPaint = (typeof ICON_PAINTS)[number];

/** Linear's brand indigo, the plugin's own color. */
export const LINEAR_INDIGO = "#5E6AD2";
export const MAX_SVG_LENGTH = 64_000;
export const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export const IconSettingsSchema = z.object({
  /** Checked SVG markup. Empty uses the built-in icon. */
  svg: z.string().max(MAX_SVG_LENGTH).default(""),
  paint: z.enum(ICON_PAINTS).default("original"),
  /** The color of the custom paint. */
  color: z.string().regex(HEX_COLOR).default(LINEAR_INDIGO),
  /** Fill shapes that only have an outline. */
  solid: z.boolean().default(false),
});
export type IconSettings = z.infer<typeof IconSettingsSchema>;

const BLOCKED: readonly (readonly [RegExp, string])[] = [
  [/<!DOCTYPE|<!ENTITY/i, "The SVG has a DOCTYPE or entities. Export it again without them."],
  [/<script[\s>/]/i, "The SVG has a script. Use an SVG with shapes only."],
  [/<foreignObject[\s>/]/i, "The SVG has HTML content. Use an SVG with shapes only."],
  [/<[^>]*\son[a-z]+\s*=/i, "The SVG has event handlers. Use an SVG with shapes only."],
  [/[\s:]href\s*=\s*["']\s*(?!#)/i, "The SVG links to other files or images. Use an SVG that has all its shapes inside."],
  [/url\(\s*["']?\s*(?!#)/i, "The SVG uses files outside it. Use an SVG that has all its shapes inside."],
  [/@import/i, "The SVG imports styles from another file."],
];

const ROOT_TAG = /^<svg\b[^>]*>/i;
const NUMBER = String.raw`(-?[\d.]+(?:e[-+]?\d+)?)`;
const VIEW_BOX = new RegExp(String.raw`\sviewBox\s*=\s*["']\s*${NUMBER}[\s,]+${NUMBER}[\s,]+${NUMBER}[\s,]+${NUMBER}\s*["']`, "i");

const attribute = (tag: string, name: string) =>
  new RegExp(String.raw`\s${name}\s*=\s*["']([^"']*)["']`, "i").exec(tag)?.[1]?.trim() ?? null;
const withoutAttribute = (tag: string, name: string) =>
  tag.replace(new RegExp(String.raw`\s${name}\s*=\s*(?:"[^"]*"|'[^']*')`, "gi"), "");

/** The root's viewBox as x, y, width, and height, or null without a usable one. */
export function viewBoxOf(svg: string): [number, number, number, number] | null {
  const root = ROOT_TAG.exec(svg)?.[0] ?? "";
  const box = VIEW_BOX.exec(root)?.slice(1, 5).map(Number);
  if (!box || box.some((value) => !Number.isFinite(value))) return null;
  const [x = 0, y = 0, width = 0, height = 0] = box;
  return width > 0 && height > 0 ? [x, y, width, height] : null;
}

/** Checks pasted or uploaded SVG and returns it ready to save, or why it cannot be used. */
export function parseIconSvg(text: string): { svg: string } | { error: string } {
  const svg = text
    .replace(/^\uFEFF/, "")
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  if (!svg) return { error: "Paste SVG markup or choose an SVG file." };
  if (svg.length > MAX_SVG_LENGTH) {
    return { error: `The SVG is too large. Use one under ${Math.round(MAX_SVG_LENGTH / 1000)} KB.` };
  }
  if (!/^<svg[\s>]/i.test(svg) || !/<\/svg>$/i.test(svg)) {
    return { error: "This is not an SVG. It must start with <svg and end with </svg>." };
  }
  for (const [pattern, error] of BLOCKED) if (pattern.test(svg)) return { error };
  const root = ROOT_TAG.exec(svg)?.[0] ?? "";
  let next = root;
  if (!viewBoxOf(svg)) {
    const width = Number(/^([\d.]+)(?:px)?$/.exec(attribute(root, "width") ?? "")?.[1]);
    const height = Number(/^([\d.]+)(?:px)?$/.exec(attribute(root, "height") ?? "")?.[1]);
    if (!(width > 0 && height > 0)) return { error: "The SVG needs a viewBox, or a width and height in pixels." };
    next = withoutAttribute(next, "viewBox").replace(/^<svg/i, `<svg viewBox="0 0 ${width} ${height}"`);
  }
  // The image scales to its box from the viewBox, so a fixed size would only crop it.
  next = withoutAttribute(withoutAttribute(next, "width"), "height");
  if (!/\sxmlns\s*=/.test(next)) next = next.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return { svg: next + svg.slice(root.length) };
}

/** Keeps a color inside an attribute value; anything else becomes gray. */
export function safeColor(color: string): string {
  return /^[#a-z0-9(),.%\s-]+$/i.test(color) ? color.trim() : "#888888";
}

const FILL_NONE = /(?<![\w-])(fill\s*:\s*)none\b/gi;

/** Fills shapes that only have an outline, with their stroke color or the icon color. */
export function fillOutlines(svg: string): string {
  const tags = svg.replace(/<([a-z][\w:.-]*)(\s[^>]*?)?(\/?)>/gi, (tag, name: string, attrs: string | undefined, close: string) => {
    if (!attrs) return tag;
    const stroke = attribute(attrs, "stroke") ?? /(?<![\w-])stroke\s*:\s*([^;"']+)/i.exec(attrs)?.[1]?.trim();
    const fill = stroke && stroke !== "none" ? stroke : "currentColor";
    const next = attrs.replace(/(\sfill\s*=\s*["'])\s*none\s*(["'])/gi, `$1${fill}$2`).replace(FILL_NONE, `$1${fill}`);
    return `<${name}${next}${close}>`;
  });
  return tags.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_all, open: string, css: string, end: string) =>
    `${open}${css.replace(FILL_NONE, "$1currentColor")}${end}`,
  );
}

const TINT_ID = "paseo-linear-tint";

/** Paints every visible pixel one color and keeps its transparency. */
export function tint(svg: string, color: string): string {
  const [x, y, width, height] = viewBoxOf(svg) ?? [0, 0, 24, 24];
  const filter =
    `<filter id="${TINT_ID}" filterUnits="userSpaceOnUse" x="${x - width}" y="${y - height}" width="${width * 3}" height="${height * 3}" color-interpolation-filters="sRGB">` +
    `<feFlood flood-color="${safeColor(color)}"/><feComposite in2="SourceAlpha" operator="in"/></filter>`;
  return svg
    .replace(ROOT_TAG, (root) => `${root}<defs>${filter}</defs><g filter="url(#${TINT_ID})">`)
    .replace(/<\/svg>$/i, "</g></svg>");
}

export interface IconLook {
  /** The color `currentColor` takes: the color Paseo gives the icon. */
  ink: string;
  /** One color for the whole icon, or null to keep its colors. */
  paint: string | null;
  solid: boolean;
}

/** The SVG to draw for saved markup, or null when it no longer passes the checks. */
export function iconMarkup(saved: string, look: IconLook): string | null {
  const parsed = parseIconSvg(saved);
  if ("error" in parsed) return null;
  const filled = look.solid ? fillOutlines(parsed.svg) : parsed.svg;
  const inked = filled.replace(/currentColor/gi, safeColor(look.ink));
  return look.paint ? tint(inked, look.paint) : inked;
}

/** The one color a paint gives, or null for the icon's own colors. */
export function paintColor(icon: IconSettings, colors: { ink: string; accent: string }): string | null {
  switch (icon.paint) {
    case "original":
      return null;
    case "theme":
      return colors.ink;
    case "accent":
      return colors.accent;
    case "linear":
      return LINEAR_INDIGO;
    case "custom":
      return icon.color;
  }
}
