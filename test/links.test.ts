import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileLinks } from "../server/links";
import { aliasesFrom, fileReferences, joinPath, parseLooseJson } from "../shared/links";

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "shop", workspaces: ["packages/*"], main: "src/index.ts", scripts: { build: "node scripts/build.mjs" } }),
  "tsconfig.json": `{
    // Aliases, with a trailing comma the way editors write them.
    "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"], }, },
  }`,
  "src/index.ts": `import { cart } from "./cart";\nimport type { Rate } from "@/shipping/rates.js";\nimport { money } from "@shop/money";\nexport * from "./payment/index";\nconst lazy = () => import("./lazy");\nimport React from "react";`,
  "src/cart.ts": "export const cart = 1;",
  "src/lazy.tsx": "export default null;",
  "src/shipping/rates.ts": "export type Rate = number;",
  "src/payment/index.ts": `const legacy = require("../cart");`,
  "src/styles/main.scss": `@use "theme";\n@import "./reset.css";`,
  "src/styles/_theme.scss": "$x: 1;",
  "src/styles/reset.css": "",
  "packages/money/package.json": JSON.stringify({ name: "@shop/money", main: "src/index.ts" }),
  "packages/money/src/index.ts": "export const money = 1;",
  "scripts/build.mjs": "",
  "docs/guide.md": "See [the cart](../src/cart.ts#L1), [site](https://example.test), and [setup](./setup.md).",
  "docs/setup.md": "",
  ".github/workflows/ci.yml": "steps:\n  - run: node scripts/build.mjs\n  - run: cat docs/guide.md",
  "app/__init__.py": "",
  "app/models.py": "from .db import session\nfrom . import utils\nimport app.config",
  "app/db.py": "",
  "app/utils.py": "",
  "app/config.py": "",
  "go.mod": "module example.test/shop\n\ngo 1.22",
  "cmd/main.go": `package main\n\nimport (\n\t"fmt"\n\t"example.test/shop/internal/store"\n)`,
  "internal/store/store.go": "package store",
  "internal/store/cache.go": "package store",
  "crate/src/lib.rs": "mod parser;\nuse crate::parser::tokens;",
  "crate/src/parser.rs": "",
};

let root = "";
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "live-links-"));
  for (const [file, text] of Object.entries(FILES)) {
    await mkdir(path.dirname(path.join(root, "repo", file)), { recursive: true });
    await writeFile(path.join(root, "repo", file), text);
  }
  await writeFile(path.join(root, "secret.ts"), "export const key = 1;");
  await symlink(path.join(root, "secret.ts"), path.join(root, "repo", "src/escape.ts"));
  await writeFile(path.join(root, "repo", "src/uses-escape.ts"), `import "./escape";`);
  await writeFile(path.join(root, "repo", "logo.png"), Buffer.from([0x89, 0x50, 0, 0, 0x2f]));
});
afterAll(() => rm(root, { recursive: true, force: true }));

const linksOf = async (files: string[]) =>
  (await fileLinks(path.join(root, "repo"), files)).map((link) => `${link.from} -${link.kind}-> ${link.to}`).sort();

describe("file links", () => {
  it("resolves script imports, aliases, compiled extensions, folders, and workspace packages", async () => {
    expect(await linksOf(["src/index.ts", "src/payment/index.ts"])).toEqual([
      "src/index.ts -import-> packages/money/src/index.ts",
      "src/index.ts -import-> src/cart.ts",
      "src/index.ts -import-> src/lazy.tsx",
      "src/index.ts -import-> src/payment/index.ts",
      "src/index.ts -import-> src/shipping/rates.ts",
      "src/payment/index.ts -import-> src/cart.ts",
    ]);
  });

  it("links styles, Markdown, package entry points, and paths named in workflows", async () => {
    expect(await linksOf(["src/styles/main.scss", "docs/guide.md", "package.json", ".github/workflows/ci.yml"])).toEqual([
      ".github/workflows/ci.yml -mention-> docs/guide.md",
      ".github/workflows/ci.yml -mention-> scripts/build.mjs",
      "docs/guide.md -link-> docs/setup.md",
      "docs/guide.md -link-> src/cart.ts",
      "package.json -link-> scripts/build.mjs",
      "package.json -link-> src/index.ts",
      "src/styles/main.scss -link-> src/styles/_theme.scss",
      "src/styles/main.scss -link-> src/styles/reset.css",
    ]);
  });

  it("resolves Python, Go, and Rust modules", async () => {
    expect(await linksOf(["app/models.py", "cmd/main.go", "crate/src/lib.rs"])).toEqual([
      "app/models.py -import-> app/config.py",
      "app/models.py -import-> app/db.py",
      "app/models.py -import-> app/utils.py",
      "cmd/main.go -import-> internal/store/cache.go",
      "cmd/main.go -import-> internal/store/store.go",
      "crate/src/lib.rs -import-> crate/src/parser.rs",
    ]);
  });

  it("never follows a link outside the folder and skips binary files", async () => {
    expect(await linksOf(["src/uses-escape.ts", "logo.png", "../secret.ts"])).toEqual([]);
  });
});

describe("link parsing", () => {
  it("keeps paths inside the repository", () => {
    expect(joinPath("src/a", "../b/./c.ts")).toBe("src/b/c.ts");
    expect(joinPath("src", "../../etc/passwd")).toBeNull();
  });

  it("reads tsconfig paths from loose JSON", () => {
    const config = parseLooseJson(`{ /* c */ "compilerOptions": { "baseUrl": "web", "paths": { "~/*": ["app/*"], "x": ["y"] } } }`);
    expect(aliasesFrom(config)).toEqual([{ prefix: "~/", targets: ["web/app"] }]);
    expect(parseLooseJson(`{"url": "https://example.test//not-a-comment"}`)).toEqual({ url: "https://example.test//not-a-comment" });
  });

  it("ignores bare package imports and web links", () => {
    expect(fileReferences("src/a.ts", `import x from "react";`)).toEqual([]);
    expect(fileReferences("docs/a.md", "[x](https://example.test/a.md) [y](mailto:a@b.c)")).toEqual([]);
  });
});
