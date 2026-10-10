import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerAgentHooks } from "./server/agent-hooks";
import { registerAgentTools } from "./server/agent-tools";
import { createCredentialStore, defaultCredentialPath } from "./server/credentials";
import { registerHandlers } from "./server/handlers";
import { registerInit } from "./server/init";
import { registerSync } from "./server/sync";
import { accessRpc, type LinearSettings, linearSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(linearSettings);
  const readSettings = async (): Promise<LinearSettings | null> => {
    const state = await settings.read();
    return state.status === "ready" ? state.values : null;
  };
  const credentialPath = defaultCredentialPath();
  const access = registerHandlers(server, {
    credentials: createCredentialStore({ file: credentialPath }),
  });
  const dataDirectory = path.dirname(credentialPath);
  registerSync(server, { access, readSettings });
  registerInit(server, { readSettings });
  registerAgentHooks(server, dataDirectory);
  const closeTools = registerAgentTools(server, { access, dataDirectory, readSettings });
  server.handle(accessRpc, async () => {
    const values = await readSettings();
    return values?.access ?? linearSettings.schema.parse({}).access;
  });
  return closeTools;
}
