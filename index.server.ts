import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createCredentialStore, defaultCredentialPath } from "./server/credentials";
import { registerHandlers } from "./server/handlers";
import { linearSettings } from "./shared/settings";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(linearSettings);
  registerHandlers(server, {
    credentials: createCredentialStore({ file: defaultCredentialPath() }),
  });
  return () => {};
}
