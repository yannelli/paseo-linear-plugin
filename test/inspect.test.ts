import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commandsOf,
  composeServices,
  detectAreas,
  guideFiles,
  inspectProject,
  listProjectFiles,
  type Manifest,
} from "../server/inspect";
import { createKnowledge, KNOWLEDGE_MAX_AGE_MS, toBrief } from "../server/knowledge";
import { explorePrompt } from "../server/live";
import { initPrompt } from "../server/init";
import type { IssueDetail } from "../shared/linear";
import type { ProjectKnowledge } from "../shared/knowledge";

const temporary: string[] = [];
async function scratch() {
  const dir = await mkdtemp(path.join(tmpdir(), "linear-inspect-"));
  temporary.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function write(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), text);
  }
}

const manifest = (kind: Manifest["kind"], name: string | null = null, services: Manifest["services"] = []): Manifest => ({
  kind,
  name,
  services,
});

describe("areas from files", () => {
  it("finds services, packages, and top folders, and skips fixtures", () => {
    const files = [
      "package.json",
      "docker-compose.yml",
      "packages/ui/package.json",
      "packages/ui/src/button.tsx",
      "services/api/go.mod",
      "services/api/main.go",
      "worker/Dockerfile",
      "worker/run.py",
      "test/fixtures/app/package.json",
      "test/a.test.ts",
      "docs/setup.md",
    ];
    const manifests = new Map<string, Manifest>([
      ["package.json", manifest("manifest", "shop")],
      ["docker-compose.yml", manifest("compose", null, [{ name: "jobs", path: "worker/" }])],
      ["packages/ui/package.json", manifest("manifest", "@shop/ui")],
      ["services/api/go.mod", manifest("manifest", "api")],
      ["worker/Dockerfile", manifest("marker")],
    ]);
    const areas = detectAreas(files, manifests, "shop-repo");
    const summary = areas.map((area) => [area.path, area.name, area.kind, area.role, area.files]);
    expect(summary).toEqual([
      ["", "shop", "package", "", 11],
      ["docs/", "docs", "folder", "docs", 1],
      ["packages/", "packages", "folder", "packages", 2],
      ["packages/ui/", "@shop/ui", "package", "frontend", 2],
      ["services/", "services", "folder", "services", 2],
      ["services/api/", "api", "service", "backend", 2],
      ["test/", "test", "folder", "tests", 2],
      ["worker/", "jobs", "service", "", 2],
    ]);
    expect(areas.find((area) => area.path === "worker/")?.manifests).toEqual(["docker-compose.yml", "Dockerfile"]);
  });

  it("adds the subfolders of a folder that holds most files", () => {
    const files = ["src/a/1.ts", "src/a/2.ts", "src/b/3.ts", "README.md"];
    expect(detectAreas(files, new Map(), "x").map((area) => area.path)).toEqual(["src/", "src/a/", "src/b/"]);
  });

  it("reads compose services that build from folders inside the root", () => {
    const text = [
      "version: '3'",
      "services:",
      "  api:",
      "    build: ./api",
      "  web:",
      "    build:",
      "      context: web",
      "  db:",
      "    image: postgres",
      "  escape:",
      "    build: ../../other",
      "volumes:",
      "  data:",
    ].join("\n");
    expect(composeServices(text, "deploy/")).toEqual([
      { name: "api", path: "deploy/api/" },
      { name: "web", path: "deploy/web/" },
    ]);
  });

  it("lists guides and commands", () => {
    const files = ["README.md", "server/AGENTS.md", ".github/workflows/ci.yml", "docs/README.md", "pnpm-lock.yaml"];
    expect(guideFiles(files)).toEqual(["README.md", "server/AGENTS.md", ".github/workflows/ci.yml"]);
    const scripts = JSON.stringify({ scripts: { dev: "vite", test: "vitest", check: "tsc" } });
    expect(commandsOf(files, scripts, "build:\n\tgo build\nVAR := 1\n")).toEqual([
      "pnpm run check",
      "pnpm run test",
      "pnpm run dev",
      "make build",
    ]);
  });
});

describe("project inspection", () => {
  it("uses git and its ignore rules, and stays inside the root", async () => {
    const root = await scratch();
    const outside = await scratch();
    await write(root, {
      ".gitignore": "dist/\n",
      "package.json": JSON.stringify({ name: "shop", scripts: { test: "vitest" } }),
      "dist/out.js": "",
      "server/index.ts": "",
      "services/billing/package.json": JSON.stringify({ name: "billing-api" }),
      "services/billing/Dockerfile": "",
    });
    await write(outside, { "package.json": JSON.stringify({ name: "secret" }) });
    await symlink(path.join(outside, "package.json"), path.join(root, "server", "package.json"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    const knowledge = await inspectProject(root, "p1", new Date("2026-10-08T00:00:00Z"));
    expect(knowledge.source).toBe("git");
    expect(knowledge.files).not.toContain("dist/out.js");
    expect(knowledge.files).toContain("server/index.ts");
    expect(knowledge.commands).toEqual(["npm run test"]);
    const names = Object.fromEntries(knowledge.areas.map((area) => [area.path, `${area.name}:${area.kind}`]));
    expect(names["services/billing/"]).toBe("billing-api:service");
    expect(names["server/"]).toBe("server:package");
    expect(JSON.stringify(knowledge)).not.toContain("secret");
  });

  it("walks the folder when it is not in a repository, and cuts deep files first", async () => {
    const root = await scratch();
    await write(root, { "a.ts": "", "node_modules/x/index.js": "", "src/deep/b.ts": "", "src/c.ts": "" });
    const listing = await listProjectFiles(root, 2);
    expect(listing.source === "walk" || listing.source === "git").toBe(true);
    if (listing.source === "walk") {
      expect(listing).toMatchObject({ files: ["a.ts", "src/c.ts"], truncated: true });
    }
  });
});

const sample = (inspectedAt: string, summary = ""): ProjectKnowledge => ({
  projectId: "p1",
  rootPath: "/shop",
  inspectedAt,
  source: "git",
  files: ["server/a.ts"],
  fileCount: 1,
  truncated: false,
  areas: [
    { path: "server/", name: "server", kind: "folder", role: "backend", manifests: [], files: 1, languages: [], summary },
    { path: ".github/", name: ".github", kind: "folder", role: "CI", manifests: [], files: 1, languages: [], summary: "" },
  ],
  languages: [],
  guides: [],
  commands: [],
  summary: "",
  summarizedAt: null,
});

describe("retained knowledge", () => {
  it("keeps knowledge on disk, inspects again when stale, and keeps the setup agent's notes", async () => {
    const directory = await scratch();
    let clock = Date.parse("2026-10-08T00:00:00Z");
    let inspections = 0;
    const inspect = async () => {
      inspections += 1;
      return sample(new Date(clock).toISOString());
    };
    const knowledge = createKnowledge(directory, inspect, () => clock);
    const project = { projectId: "p1", rootPath: "/shop" };
    await Promise.all([knowledge.ensure(project), knowledge.ensure(project)]);
    expect(inspections).toBe(1);
    await knowledge.annotate("p1", {
      summary: " A shop ",
      areas: [
        { path: "./server", summary: "Daemon handlers" },
        { path: ".github", summary: "CI workflows" },
      ],
    });

    const reloaded = createKnowledge(directory, inspect, () => clock);
    expect((await reloaded.ensure(project)).areas[0]?.summary).toBe("Daemon handlers");
    expect(inspections).toBe(1);

    clock += KNOWLEDGE_MAX_AGE_MS + 1;
    const fresh = await reloaded.ensure(project);
    expect(inspections).toBe(2);
    expect(fresh).toMatchObject({
      summary: "A shop",
      areas: [{ summary: "Daemon handlers" }, { summary: "CI workflows" }],
    });
    expect(toBrief(fresh)).not.toHaveProperty("files");
    expect(toBrief(fresh).folders).toEqual([{ name: "server/", files: 1 }]);
  });

  it("keeps saved knowledge when an inspection fails", async () => {
    const directory = await scratch();
    let fail = false;
    let clock = 0;
    const knowledge = createKnowledge(
      directory,
      async () => {
        if (fail) throw new Error("gone");
        return sample(new Date(clock).toISOString());
      },
      () => clock,
    );
    const project = { projectId: "p1", rootPath: "/shop" };
    await knowledge.ensure(project);
    fail = true;
    clock += KNOWLEDGE_MAX_AGE_MS + 1;
    expect((await knowledge.ensure(project)).projectId).toBe("p1");
    await expect(knowledge.inspect(project)).rejects.toThrow("gone");
  });
});

describe("agent prompts", () => {
  const issue = {
    identifier: "ENG-1",
    title: "Refunds",
    description: "Fix refunds.",
    url: "https://linear.app/acme/issue/ENG-1",
    team: { id: "t", key: "ENG", name: "Engineering" },
    state: { id: "s", name: "Todo", type: "unstarted", color: "#ccc", position: 1 },
    priorityLabel: "High",
    labels: [],
    parent: null,
    attachments: [],
    comments: [],
    children: [],
  } as unknown as IssueDetail;

  it("give explore and setup agents the project map", () => {
    const known = sample("2026-10-08T00:00:00.000Z");
    expect(explorePrompt(issue, known)).toContain("- server/ server · backend, 1 file");
    expect(explorePrompt(issue)).not.toContain("Project map");
    const setup = initPrompt("/shop", known);
    expect(setup).toContain("Folders (file count):");
    expect(setup).toContain('"areas":[{"path":"server/","summary":"..."}]');
    expect(initPrompt("/shop")).toContain("- areas: an empty list.");
  });
});
