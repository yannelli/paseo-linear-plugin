import { describe, expect, it } from "vitest";
import {
  fillOutlines,
  IconSettingsSchema,
  iconMarkup,
  LINEAR_INDIGO,
  paintColor,
  parseIconSvg,
  safeColor,
  tint,
  viewBoxOf,
} from "../shared/custom-icon";

const OUTLINE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>';

const svgOf = (text: string) => {
  const parsed = parseIconSvg(text);
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed.svg;
};

describe("parseIconSvg", () => {
  it("keeps clean SVG and drops the XML declaration, comments, and a fixed size", () => {
    const svg = svgOf(
      `\uFEFF<?xml version="1.0"?>\n<!-- exported -->\n<svg viewBox="0 0 16 16" width="16" height="16"><path d="M0 0h16v16z"/></svg>\n`,
    );
    expect(svg).toBe('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16z"/></svg>');
    expect(svgOf(OUTLINE)).toBe(OUTLINE);
  });

  it("makes a viewBox from a pixel width and height", () => {
    const svg = svgOf('<svg width="32px" height="20"><rect width="32" height="20"/></svg>');
    expect(viewBoxOf(svg)).toEqual([0, 0, 32, 20]);
    expect(svg).toContain('<rect width="32" height="20"/>');
    expect(parseIconSvg('<svg width="2em" height="2em"><rect/></svg>')).toHaveProperty("error");
  });

  it("refuses markup that is not SVG or is too large", () => {
    expect(parseIconSvg("")).toHaveProperty("error");
    expect(parseIconSvg("<html><svg></svg></html>")).toHaveProperty("error");
    expect(parseIconSvg('<svg viewBox="0 0 1 1"/>')).toHaveProperty("error");
    expect(parseIconSvg(`<svg viewBox="0 0 1 1">${"<g/>".repeat(20_000)}</svg>`)).toHaveProperty("error");
  });

  it("refuses scripts, handlers, HTML, entities, and outside files", () => {
    const blocked = [
      '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>',
      '<svg viewBox="0 0 1 1" onload="alert(1)"><path/></svg>',
      '<svg viewBox="0 0 1 1"><foreignObject><div/></foreignObject></svg>',
      '<!DOCTYPE svg [<!ENTITY a "b">]><svg viewBox="0 0 1 1"></svg>',
      '<svg viewBox="0 0 1 1"><image href="https://example.test/a.png"/></svg>',
      '<svg viewBox="0 0 1 1"><image xlink:href="data:image/png;base64,AAAA"/></svg>',
      '<svg viewBox="0 0 1 1"><path style="fill:url(https://example.test/p.svg#a)"/></svg>',
      '<svg viewBox="0 0 1 1"><style>@import "x.css";</style></svg>',
    ];
    for (const text of blocked) expect(parseIconSvg(text), text).toHaveProperty("error");
  });

  it("allows references inside the SVG", () => {
    const svg = '<svg viewBox="0 0 1 1"><defs><linearGradient id="g"/></defs><use href="#a"/><path fill="url(#g)"/></svg>';
    expect(parseIconSvg(svg)).toHaveProperty("svg");
  });
});

describe("icon transforms", () => {
  it("fills outlines with the stroke color, in attributes, styles, and style sheets", () => {
    expect(fillOutlines(OUTLINE)).toContain('fill="currentColor" stroke="currentColor"');
    expect(fillOutlines('<svg><path fill="none" stroke="#f00"/><rect style="fill:none;stroke:#00f"/></svg>')).toBe(
      '<svg><path fill="#f00" stroke="#f00"/><rect style="fill:#00f;stroke:#00f"/></svg>',
    );
    expect(fillOutlines("<svg><style>.a{fill: none}</style></svg>")).toBe("<svg><style>.a{fill: currentColor}</style></svg>");
    expect(fillOutlines('<svg><path fill-rule="evenodd" fill="#123"/></svg>')).toBe('<svg><path fill-rule="evenodd" fill="#123"/></svg>');
  });

  it("tints with a filter that covers the viewBox and its margins", () => {
    const tinted = tint('<svg viewBox="2 4 10 20"><path/></svg>', "#ff0000");
    expect(tinted).toMatch(/^<svg viewBox="2 4 10 20"><defs><filter id="paseo-linear-tint" filterUnits="userSpaceOnUse" x="-8" y="-16" width="30" height="60"/);
    expect(tinted).toContain('<feFlood flood-color="#ff0000"/>');
    expect(tinted).toMatch(/<g filter="url\(#paseo-linear-tint\)"><path\/><\/g><\/svg>$/);
  });

  it("draws currentColor in the ink, and paints only when asked", () => {
    const look = { ink: "rgba(1, 2, 3, 0.5)", paint: null, solid: false };
    expect(iconMarkup(OUTLINE, look)).toContain('stroke="rgba(1, 2, 3, 0.5)"');
    expect(iconMarkup(OUTLINE, look)).not.toContain("filter");
    const solid = iconMarkup(OUTLINE, { ...look, solid: true, paint: "#00ff00" });
    expect(solid).toContain('fill="rgba(1, 2, 3, 0.5)"');
    expect(solid).toContain('flood-color="#00ff00"');
    expect(iconMarkup("<svg><script/></svg>", look)).toBeNull();
  });

  it("keeps colors safe inside attributes", () => {
    expect(safeColor("#abc")).toBe("#abc");
    expect(safeColor('red" onload="x')).toBe("#888888");
    expect(safeColor("<b>")).toBe("#888888");
  });

  it("resolves each paint, with defaults that keep the icon as drawn", () => {
    const icon = IconSettingsSchema.parse({});
    expect(icon).toEqual({ svg: "", paint: "original", color: LINEAR_INDIGO, solid: false });
    const colors = { ink: "#111111", accent: "#222222" };
    expect(paintColor(icon, colors)).toBeNull();
    expect(paintColor({ ...icon, paint: "theme" }, colors)).toBe("#111111");
    expect(paintColor({ ...icon, paint: "accent" }, colors)).toBe("#222222");
    expect(paintColor({ ...icon, paint: "linear" }, colors)).toBe(LINEAR_INDIGO);
    expect(paintColor({ ...icon, paint: "custom", color: "#abcdef" }, colors)).toBe("#abcdef");
    expect(IconSettingsSchema.safeParse({ color: "red" }).success).toBe(false);
  });
});
