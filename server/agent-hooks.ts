import { createHash } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { agentHooksRpc, claudeHooks, hookPluginName, IDENTIFIER } from "../shared/agent-hooks";

// Writes one Claude Code plugin folder per issue under the plugin's data folder. A launch passes
// the folder to Claude with --plugin-dir. The name holds a hash of the hooks, so a later launch
// never changes the hooks of a running agent. Resumed agents keep using it, so it stays.

async function writeAtomic(file: string, text: string) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, file);
}

export function registerAgentHooks(server: PluginServerContext, dataDirectory: string) {
  server.handle(agentHooksRpc, async ({ issue, guidance }) => {
    // The hooks run printf in a POSIX shell, which Windows hosts do not have.
    if (process.platform === "win32" || !IDENTIFIER.test(issue.identifier)) return { pluginDir: null };
    const hooks = claudeHooks(issue, guidance);
    if (!hooks) return { pluginDir: null };
    const text = `${JSON.stringify(hooks, null, 2)}\n`;
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 12);
    const root = path.join(dataDirectory, "claude-hooks", `${issue.identifier.toUpperCase()}-${hash}`);
    await mkdir(path.join(root, ".claude-plugin"), { recursive: true, mode: 0o700 });
    await mkdir(path.join(root, "hooks"), { recursive: true, mode: 0o700 });
    const manifest = {
      name: hookPluginName(issue.identifier),
      version: "1.0.0",
      description: `Linear context for ${issue.identifier} from the Paseo Linear plugin`,
    };
    await writeAtomic(path.join(root, ".claude-plugin", "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeAtomic(path.join(root, "hooks", "hooks.json"), text);
    return { pluginDir: root };
  });
}
