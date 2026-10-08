import { describe, expect, it } from "vitest";
import type { FileTouch } from "../shared/activity";
import {
  type AreaRef,
  areasIn,
  areaOf,
  folderLines,
  knowledgeLines,
  type ProjectKnowledge,
  resolvePaths,
  whereLabel,
} from "../shared/knowledge";
import { semanticMap } from "../shared/live";
import { buildMapModel, offMapLine, offMapWhere, zoneAreaLabel } from "../shared/map-model";

const area = (path: string, name: string, kind: AreaRef["kind"], role = ""): AreaRef => ({
  path,
  name,
  kind,
  role,
  summary: "",
});
const AREAS = [
  area("", "shop", "package"),
  area("services/billing/", "billing-api", "service"),
  area("docs/", "docs", "folder", "docs"),
  area("server/", "server", "folder", "backend"),
];
const touch = (path: string, edits = 0): FileTouch => ({
  path,
  reads: edits > 0 ? 0 : 1,
  edits,
  added: edits,
  removed: 0,
  created: false,
  order: 0,
  last: edits > 0 ? "edit" : "read",
});

describe("areas", () => {
  it("finds the deepest area and labels it", () => {
    expect(areaOf("services/billing/src/a.ts", AREAS)?.name).toBe("billing-api");
    expect(areaOf("README.md", AREAS)?.name).toBe("shop");
    expect(whereLabel("services/billing/src/a.ts", AREAS)).toBe("billing-api · service");
    expect(whereLabel("server/x.ts", AREAS)).toBe("server · backend");
    expect(whereLabel("README.md", AREAS)).toBe("./");
    expect(whereLabel("lib/x.ts", [])).toBe("lib/");
  });

  it("matches services by name and folders only when the text calls them a folder", () => {
    const named = (text: string) => areasIn(text, AREAS).map((entry) => entry.path);
    expect(named("Totals are wrong in billing-api after a refund")).toEqual(["services/billing/"]);
    expect(named("The billing service rounds totals")).toEqual(["services/billing/"]);
    expect(named("Restart the server when it crashes")).toEqual([]);
    expect(named("Move the handler into the server folder")).toEqual(["server/"]);
    expect(named("Update the docs directory and docs/setup.md")).toEqual(["docs/"]);
    expect(named("A shop-wide change")).toEqual([]);
  });
});

describe("ticket paths", () => {
  const files = ["server/linear.ts", "client/linear.tsx", "shared/linear.ts", "server/queries.ts", "docs/a.md"];

  it("matches a path to the one file that ends with it", () => {
    const resolved = resolvePaths(["queries.ts", "linear.ts", "server/linear.ts", "new/file.ts", "a.md"], files);
    expect(Object.fromEntries(resolved)).toEqual({ "queries.ts": "server/queries.ts", "a.md": "docs/a.md" });
    expect(Object.fromEntries(resolvePaths(["linear/", "docs/"], ["src/linear/x.ts", "docs/a.md"]))).toEqual({
      "linear/": "src/linear/",
    });
  });

  it("puts resolved paths and named services on the ticket-text map", () => {
    const issue = {
      identifier: "ENG-1",
      title: "Refund totals",
      description: "ENG-2: fix `queries.ts`\nCheck the billing service too.",
      children: [{ identifier: "ENG-2", title: "Queries" }],
    };
    const map = semanticMap(issue, new Date("2026-10-08T00:00:00Z"), {
      resolved: new Map([["queries.ts", "server/queries.ts"]]),
      areas: AREAS,
    });
    expect(map.files).toEqual([
      { path: "server/queries.ts", issue: "ENG-2" },
      { path: "services/billing/", issue: "ENG-1" },
    ]);
  });
});

describe("off-map labels", () => {
  const files = [{ path: "server/queries.ts", issue: "ENG-1" }];

  it("groups off-map files by area and names where the agent is", () => {
    const touches = [
      touch("server/queries.ts", 2),
      touch("services/billing/src/refund.ts"),
      touch("services/billing/src/total.ts", 1),
      touch("docs/guide.md"),
    ];
    const model = buildMapModel(files, touches, new Map(), [], AREAS);
    expect(model.offMap).toEqual([
      { where: "billing-api · service", files: 2 },
      { where: "docs", files: 1 },
    ]);
    expect(offMapLine(model)).toBe("Off the map: billing-api · service (2), docs (1)");
    expect(offMapWhere(model, "services/billing/src/total.ts", AREAS)).toBe("billing-api · service");
    expect(offMapWhere(model, "server/queries.ts", AREAS)).toBeNull();
    expect(offMapLine(buildMapModel(files, [touch("server/queries.ts")], new Map()))).toBeNull();
  });

  it("names a zone's area only where its folder does not already say it", () => {
    const model = buildMapModel(
      [
        { path: "server/a.ts", issue: "ENG-1" },
        { path: "services/billing/src/b.ts", issue: "ENG-1" },
        { path: "c.ts", issue: "ENG-1" },
      ],
      [],
      new Map(),
      [],
      AREAS,
    );
    const labels = Object.fromEntries(model.zones.map((zone) => [zone.dir, zoneAreaLabel(zone)]));
    expect(labels).toEqual({ "server/": "backend", "services/billing/src/": "billing-api · service", "": null });
  });
});

describe("prompt lines", () => {
  const knowledge: ProjectKnowledge = {
    projectId: "p",
    rootPath: "/shop",
    inspectedAt: "2026-10-08T00:00:00.000Z",
    source: "git",
    files: ["README.md", "server/a.ts", "server/api/b.ts", "client/c.tsx"],
    fileCount: 4,
    truncated: false,
    areas: [
      {
        ...area("server/", "server", "folder", "backend"),
        manifests: [],
        files: 2,
        languages: ["TypeScript"],
        summary: "Daemon handlers",
      },
    ],
    languages: [{ name: "TypeScript", files: 3 }],
    guides: ["README.md"],
    commands: ["npm run check"],
    summary: "A shop",
    summarizedAt: null,
  };

  it("describes the project map an agent starts from", () => {
    const lines = knowledgeLines(knowledge);
    expect(lines).toContain("- Project: A shop");
    expect(lines).toContain("- 4 files. Languages: TypeScript 3.");
    expect(lines).toContain("- Commands: npm run check");
    expect(lines).toContain("- server/ server · backend, 2 files, TypeScript: Daemon handlers");
    expect(lines.slice(-3)).toEqual(["client/ (1)", "server/ (2)", "  server/api/ (1)"]);
    expect(knowledgeLines(null)).toEqual([]);
  });

  it("drops deeper folders when there are too many", () => {
    const files = Array.from({ length: 30 }, (_, index) => `f${index}/sub/x.ts`);
    expect(folderLines(files, 2, 40)).toHaveLength(30);
    expect(folderLines(files, 1, 10)).toHaveLength(11);
  });
});
