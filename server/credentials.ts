import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { KeySource } from "../shared/linear";

// Version 1 files hold only `apiKey`. Version 2 adds keys for individual Paseo projects.
const CredentialFileSchema = z.object({
  apiKey: z.string().min(1).optional(),
  projects: z.record(z.string(), z.object({ apiKey: z.string().min(1) })).default({}),
});
type CredentialFile = z.infer<typeof CredentialFileSchema>;

export interface ResolvedCredential {
  apiKey: string;
  source: KeySource;
}

export interface CredentialStore {
  /** Project key, then the saved default key, then LINEAR_API_KEY. */
  resolve(projectId?: string | null): Promise<ResolvedCredential | null>;
  save(apiKey: string, projectId?: string | null): Promise<void>;
  clear(projectId?: string | null): Promise<void>;
  projectKeys(): Promise<{ projectId: string; apiKey: string }[]>;
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

  async function read(): Promise<CredentialFile> {
    try {
      const parsed = CredentialFileSchema.safeParse(
        JSON.parse(await readFile(options.file, "utf8")),
      );
      return parsed.success ? parsed.data : { projects: {} };
    } catch {
      return { projects: {} };
    }
  }

  async function write(next: CredentialFile): Promise<void> {
    if (!next.apiKey && Object.keys(next.projects).length === 0) {
      await rm(options.file, { force: true });
      return;
    }
    await mkdir(path.dirname(options.file), { recursive: true, mode: 0o700 });
    const temporary = `${options.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, options.file);
  }

  return {
    async resolve(projectId) {
      const stored = await read();
      const projectKey = projectId ? stored.projects[projectId]?.apiKey : undefined;
      if (projectKey) return { apiKey: projectKey, source: "project" };
      if (stored.apiKey) return { apiKey: stored.apiKey, source: "file" };
      const fromEnv = env.LINEAR_API_KEY?.trim();
      return fromEnv ? { apiKey: fromEnv, source: "environment" } : null;
    },
    async save(apiKey, projectId) {
      const stored = await read();
      const key = apiKey.trim();
      if (projectId) {
        await write({ ...stored, projects: { ...stored.projects, [projectId]: { apiKey: key } } });
      } else {
        await write({ ...stored, apiKey: key });
      }
    },
    async clear(projectId) {
      const stored = await read();
      if (projectId) {
        const projects = { ...stored.projects };
        delete projects[projectId];
        await write({ ...stored, projects });
      } else {
        await write({ projects: stored.projects });
      }
    },
    async projectKeys() {
      const stored = await read();
      return Object.entries(stored.projects).map(([projectId, entry]) => ({
        projectId,
        apiKey: entry.apiKey,
      }));
    },
  };
}

export function keyHint(apiKey: string): string {
  return apiKey.length > 8 ? `…${apiKey.slice(-4)}` : "…";
}
