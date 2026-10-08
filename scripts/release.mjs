import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { manifestPaths, prepare, verifyConditions } from "./release-manifests.mjs";

const stableTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const betaTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/;
// Each release branch and the prerelease channel it publishes to; main publishes stable versions.
const channels = { main: null, beta: "beta" };
const levels = { patch: 1, minor: 2, major: 3 };
const releaseMarker = "<!-- paseo-linear-release -->";

export function releaseType(message) {
  const header = /^([a-z]+)(?:\([^\r\n()]+\))?(!)?: \S[^\r\n]*/.exec(message);
  if (!header) return null;
  if (header[2] || /^BREAKING[ -]CHANGE: \S/m.test(message)) return "major";
  if (header[1] === "feat") return "minor";
  if (["fix", "perf", "revert"].includes(header[1])) return "patch";
  return null;
}

export function nextVersion(version, commits) {
  if (!stableTag.test(`v${version}`)) throw new Error(`Invalid stable version: ${version}`);
  const type = commits.reduce((highest, { message }) => {
    const current = releaseType(message);
    return (levels[current] || 0) > (levels[highest] || 0) ? current : highest;
  }, null);
  if (!type) return null;
  const [major, minor, patch] = version.split(".").map(BigInt);
  if (type === "major") return `${major + 1n}.0.0`;
  if (type === "minor") return `${major}.${minor + 1n}.0`;
  return `${major}.${minor}.${patch + 1n}`;
}

/** The next beta toward a stable version, after the betas already tagged for it. */
export function nextBeta(stable, tags) {
  const prefix = `v${stable}-beta.`;
  const numbers = tags.filter((tag) => tag.startsWith(prefix) && betaTag.test(tag)).map((tag) => Number(tag.slice(prefix.length)));
  return `${stable}-beta.${numbers.length ? Math.max(...numbers) + 1 : 0}`;
}

function compareStable(a, b) {
  const [x, y] = [a, b].map((version) => version.split(".").map(BigInt));
  for (let index = 0; index < 3; index += 1) if (x[index] !== y[index]) return x[index] > y[index] ? 1 : -1;
  return 0;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function commitsSince(tag) {
  const records = git("log", ...(tag ? [`${tag}..HEAD`] : []), "--format=%H%x00%B%x00").split("\0");
  const commits = [];
  for (let i = 0; i + 1 < records.length; i += 2) {
    commits.push({ hash: records[i].trim(), message: records[i + 1].trim() });
  }
  return commits;
}

export function releaseNotes(version, previousTag, commits) {
  const sections = [
    ["Breaking changes", (message) => releaseType(message) === "major"],
    ["Features", (message) => releaseType(message) === "minor"],
    ["Fixes and performance", (message) => releaseType(message) === "patch"],
  ];
  const notes = [`# ${version}`, ""];
  for (const [title, matches] of sections) {
    const matching = commits.filter(({ message }) => matches(message));
    if (!matching.length) continue;
    notes.push(`## ${title}`, "");
    for (const { hash, message } of matching) {
      const [subject, ...body] = message.split("\n");
      notes.push(`- ${subject} (${hash.slice(0, 7)})`);
      if (releaseType(message) === "major" && body.join("\n").trim()) {
        notes.push("", ...body.map((line) => `  ${line}`), "");
      }
    }
    notes.push("");
  }
  notes.push(previousTag ? `Changes since ${previousTag}.` : "First release.", "");
  return notes.join("\n");
}

async function publishRelease(tag, notes, repository) {
  const prerelease = betaTag.test(tag);
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GH_TOKEN or GITHUB_TOKEN is required to publish a release");
  const endpoint = `${process.env.GITHUB_API_URL || "https://api.github.com"}/repos/${repository}/releases`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const existing = await fetch(`${endpoint}/tags/${tag}`, { headers });
  if (existing.ok) {
    console.log(`GitHub release ${tag} already exists`);
    return;
  }
  if (existing.status !== 404) throw new Error(`GitHub release lookup failed: HTTP ${existing.status}`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ tag_name: tag, name: tag, body: notes, draft: false, prerelease, make_latest: prerelease ? "false" : "true" }),
  });
  if (!response.ok) throw new Error(`GitHub release creation failed: HTTP ${response.status}: ${await response.text()}`);
  console.log(`Published ${(await response.json()).html_url}`);
}

export async function release({ dryRun = true } = {}) {
  const cwd = process.cwd();
  const branch = git("branch", "--show-current");
  if (!Object.hasOwn(channels, branch)) throw new Error("Releases run from main or beta");
  const channel = channels[branch];
  if (git("status", "--porcelain")) throw new Error("Release checkout must be clean");
  const currentVersion = await verifyConditions({}, { cwd });
  const merged = git("tag", "--merged", "HEAD", "--sort=-version:refname").split("\n");
  const previousTag = merged.find((tag) => stableTag.test(tag));
  // A beta manifest is allowed on main after a beta branch merges; the next stable release replaces it.
  const [currentStable, currentBeta] = currentVersion.split("-");
  if (previousTag && !currentBeta && `v${currentVersion}` !== previousTag) throw new Error(`Manifest version ${currentVersion} does not match ${previousTag}`);
  if (previousTag && currentBeta && compareStable(currentStable, previousTag.slice(1)) <= 0) {
    throw new Error(`Manifest version ${currentVersion} is not ahead of ${previousTag}`);
  }
  if (channel && !previousTag) throw new Error("A beta needs a stable release first");
  const commits = commitsSince(previousTag);
  const stable = previousTag ? nextVersion(previousTag.slice(1), commits) : currentVersion;
  let version = stable;
  if (channel && stable) {
    // Only a release-triggering commit since the last beta makes a new beta.
    const lastBeta = merged.find((tag) => betaTag.test(tag) && tag.startsWith(`v${stable}-`));
    const fresh = lastBeta ? nextVersion("0.0.0", commitsSince(lastBeta)) : stable;
    version = fresh ? nextBeta(stable, git("tag", "--list").split("\n")) : null;
  }
  const repository = process.env.GITHUB_REPOSITORY;
  if (!dryRun) {
    if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("GITHUB_REPOSITORY must be owner/repo");
    if (!(process.env.GH_TOKEN || process.env.GITHUB_TOKEN)) throw new Error("GH_TOKEN or GITHUB_TOKEN is required");
    // Finish a release whose tag was pushed but whose GitHub release failed.
    const repairTag = merged.includes(`v${currentVersion}`) ? `v${currentVersion}` : null;
    if (repairTag) {
      const annotation = git("for-each-ref", `refs/tags/${repairTag}`, "--format=%(contents)");
      if (annotation.includes(releaseMarker)) await publishRelease(repairTag, annotation.replace(releaseMarker, "").trim(), repository);
    }
  }
  if (!version) {
    console.log(`No release-triggering commits since ${previousTag}`);
    return null;
  }
  const notes = releaseNotes(version, previousTag, commits);
  if (dryRun) {
    console.log(notes);
    return version;
  }
  if (previousTag) {
    await prepare({}, { cwd, nextRelease: { version } });
    git("add", "--", ...manifestPaths);
    git("commit", "-m", `chore(release): ${version}`);
  }
  const directory = mkdtempSync(join(tmpdir(), "linear-release-notes-"));
  const notesPath = join(directory, "notes.md");
  try {
    writeFileSync(notesPath, `${notes}\n${releaseMarker}\n`);
    git("tag", "-a", `v${version}`, "-F", notesPath);
    git("push", "--atomic", "origin", `HEAD:refs/heads/${branch}`, `refs/tags/v${version}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  await publishRelease(`v${version}`, notes, repository);
  return version;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--publish", "--dry-run"].includes(args[0])) {
    throw new Error("Usage: node scripts/release.mjs --dry-run|--publish");
  }
  await release({ dryRun: args[0] === "--dry-run" });
}
