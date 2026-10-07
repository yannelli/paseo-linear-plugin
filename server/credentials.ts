import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

const CredentialFileSchema = z.object({ apiKey: z.string().min(1) });

export type CredentialSource = "file" | "environment";

export interface ResolvedCredential {
  apiKey: string;
  source: CredentialSource;
}

export interface CredentialStore {
  resolve(): Promise<ResolvedCredential | null>;
  save(apiKey: string): Promise<void>;
  clear(): Promise<void>;
}

export function defaultCredentialPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.PASEO_HOME?.trim() || path.join(homedir(), ".paseo");
  return path.join(home, "plugin-data", "linear", "credentials.json");
}

export function createCredentialStore(options: {
  file: string;
  env?: NodeJS.ProcessEnv;
}): CredentialStore {
  const env = options.env ?? process.env;

  async function readFileKey(): Promise<string | null> {
    try {
      const parsed = CredentialFileSchema.safeParse(
        JSON.parse(await readFile(options.file, "utf8")),
      );
      return parsed.success ? parsed.data.apiKey : null;
    } catch {
      return null;
    }
  }

  return {
    async resolve() {
      const stored = await readFileKey();
      if (stored) return { apiKey: stored, source: "file" };
      const fromEnv = env.LINEAR_API_KEY?.trim();
      return fromEnv ? { apiKey: fromEnv, source: "environment" } : null;
    },
    async save(apiKey) {
      const directory = path.dirname(options.file);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${options.file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({ apiKey: apiKey.trim() }), { mode: 0o600 });
      await chmod(temporary, 0o600);
      await rename(temporary, options.file);
    },
    async clear() {
      await rm(options.file, { force: true });
    },
  };
}

export function keyHint(apiKey: string): string {
  return apiKey.length > 8 ? `…${apiKey.slice(-4)}` : "…";
}
