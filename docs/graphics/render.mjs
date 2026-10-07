// Renders the README images, the GitHub social preview, and the icon from scene.html.
// Usage: node docs/graphics/render.mjs [out-dir]   (defaults to docs/images)
// Needs Playwright with Chromium. Set PLAYWRIGHT_MODULE to its entry file when it is not resolvable.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function playwrightEntry() {
  if (process.env.PLAYWRIGHT_MODULE) return process.env.PLAYWRIGHT_MODULE;
  try {
    return require.resolve("playwright");
  } catch {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    return join(globalRoot, "playwright", "index.js");
  }
}

const playwright = await import(pathToFileURL(playwrightEntry()).href);
const { chromium } = playwright.default ?? playwright;
const root = fileURLToPath(new URL(".", import.meta.url));
const outDir = resolve(process.argv[2] ?? join(root, "..", "images"));
const MAX_BYTES = 900 * 1024;
const outputs = [
  { scene: "social", file: "social-preview.png" },
  { scene: "browse", file: "browse.png" },
  { scene: "launch", file: "launch.png" },
  { scene: "keys", file: "keys.png" },
  { scene: "icon", file: "icon.png", transparent: true },
];

async function pngSize(file) {
  const bytes = await readFile(file);
  assert.equal(bytes.subarray(1, 4).toString(), "PNG", `${file} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const { scene, file, transparent } of outputs) {
    const tab = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
    const failures = [];
    tab.on("pageerror", (error) => failures.push(error.message));
    await tab.goto(pathToFileURL(join(root, "scene.html")).href);
    const layout = await tab.evaluate((name) => window.renderScene(name), scene);
    assert.equal(layout.fonts, true, `${scene}: fonts did not load`);
    assert.deepEqual(layout.problems, [], `${scene}: layout problems`);
    await tab.setViewportSize({ width: layout.width, height: layout.height });
    const output = join(outDir, file);
    await tab.screenshot({ path: output, omitBackground: Boolean(transparent) });
    assert.deepEqual(await pngSize(output), { width: layout.width * 2, height: layout.height * 2 });
    const { size } = await stat(output);
    assert(size < MAX_BYTES, `${output} is ${size} bytes`);
    assert.deepEqual(failures, []);
    console.log(`${output}: ${layout.width * 2}x${layout.height * 2}, ${Math.round(size / 1024)} KB`);
    await tab.close();
  }
} finally {
  await browser.close();
}
