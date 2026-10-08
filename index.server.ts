import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createCredentialStore, defaultCredentialPath } from "./server/credentials";
import { registerHandlers } from "./server/handlers";
import { registerInit } from "./server/init";
import { registerLive } from "./server/live";
import { createLaunchQueue, createMapStore } from "./server/stores";
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
  const maps = createMapStore(path.join(dataDirectory, "live-maps.json"));
  const launches = createLaunchQueue(path.join(dataDirectory, "pending-launches.json"));
  registerLive(server, { access, maps, launches, readSettings });
  registerSync(server, { access, readSettings });
  registerInit(server, { readSettings });
  server.handle(accessRpc, async () => {
    const values = await readSettings();
    return values?.access ?? linearSettings.schema.parse({}).access;
  });
  return () => {};
}
