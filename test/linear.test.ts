import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createCredentialStore } from "../server/credentials";
import { createLinearGraphql } from "../server/graphql";
import { createLinearIssueSearch } from "../server/linear";
import { createLinearService, issueFilter } from "../server/queries";
import type { IssueDetail } from "../shared/linear";
import { composePrompt } from "../shared/prompts";
import { emptyProjectConfig, linearSettings } from "../shared/settings";

const issue = {
  id: "issue-uuid",
  identifier: "ENG-123",
  title: "Plugin attachments",
  description: "Let extensions attach external context.",
  url: "https://linear.app/acme/issue/ENG-123/plugin-attachments",
  priorityLabel: "High",
  state: { name: "In Progress" },
  assignee: { name: "Mohamed" },
  project: { name: "Paseo" },
  labels: { nodes: [{ name: "Feature" }] },
};

interface CapturedRequest {
  authorization: string | undefined;
  body: { query: string; variables: Record<string, unknown> };
}

async function readRequest(request: IncomingMessage): Promise<CapturedRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return {
    authorization: request.headers.authorization,
    body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as CapturedRequest["body"],
  };
}

async function withLinearServer<T>(
  respond: (request: CapturedRequest, response: ServerResponse) => void,
  run: (endpoint: string) => Promise<T>,
): Promise<T> {
  const server = createServer((request, response) => {
    void readRequest(request).then((captured) => respond(captured, response));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    return await run(`http://127.0.0.1:${address.port}/graphql`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

function sendJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

describe("Linear issue search", () => {
  it("resolves an exact issue identifier and formats its agent snapshot", async () => {
    const result = await withLinearServer(
      (request, response) => {
        expect(request.authorization).toBe("lin_api_test");
        expect(request.body.variables).toEqual({ id: "ENG-123" });
        sendJson(response, { data: { issue } });
      },
      async (endpoint) => {
        const linear = createLinearIssueSearch({ apiKey: "lin_api_test", endpoint });
        return linear.search("eng-123");
      },
    );

    expect(result).toEqual({
      items: [
        {
          id: "issue-uuid",
          identifier: "ENG-123",
          title: "Plugin attachments",
          subtitle: "In Progress · Mohamed",
          url: issue.url,
          resourceType: "issue",
          text: [
            "Linear issue ENG-123: Plugin attachments",
            `URL: ${issue.url}`,
            "Status: In Progress",
            "Priority: High",
            "Assignee: Mohamed",
            "Project: Paseo",
            "Labels: Feature",
            "",
            "Let extensions attach external context.",
          ].join("\n"),
        },
      ],
    });
  });

  it("searches issue titles through a case-insensitive filter", async () => {
    const result = await withLinearServer(
      (request, response) => {
        expect(request.body.variables).toEqual({
          filter: { title: { containsIgnoreCase: "plugin" } },
        });
        sendJson(response, { data: { issues: { nodes: [issue] } } });
      },
      async (endpoint) => {
        const linear = createLinearIssueSearch({ apiKey: "lin_api_test", endpoint });
        return linear.search(" plugin ");
      },
    );

    expect(result.items.map((item) => item.identifier)).toEqual(["ENG-123"]);
  });

  it("surfaces GraphQL errors even when HTTP succeeds", async () => {
    await expect(
      withLinearServer(
        (_request, response) => sendJson(response, { errors: [{ message: "Token expired" }] }),
        async (endpoint) => {
          const linear = createLinearIssueSearch({ apiKey: "lin_api_test", endpoint });
          return linear.search("ENG-123");
        },
      ),
    ).rejects.toThrow("Token expired");
  });

  it("requires a daemon-side API key", () => {
    expect(() => createLinearIssueSearch({ apiKey: "" })).toThrow(
      "Connect Linear: add an API key in Linear settings",
    );
  });
});

const state = { id: "state-1", name: "Todo", type: "unstarted", color: "#e2e2e2", position: 1 };
const detail: IssueDetail = {
  id: "issue-uuid",
  identifier: "ENG-123",
  title: "Plugin attachments",
  url: issue.url,
  branchName: "eng-123-plugin-attachments",
  priority: 2,
  priorityLabel: "High",
  updatedAt: "2026-10-01T00:00:00.000Z",
  state,
  assignee: null,
  team: { id: "team-1", key: "ENG", name: "Engineering" },
  project: null,
  labels: [],
  description: "Let extensions attach external context.",
  createdAt: "2026-09-01T00:00:00.000Z",
  creator: null,
  parent: null,
  ancestors: [],
  children: [],
  comments: [
    {
      id: "comment-1",
      body: "Check the composer first.",
      createdAt: "2026-09-02T00:00:00.000Z",
      user: { id: "u1", name: "Ada Lovelace", displayName: "ada", avatarUrl: null },
    },
  ],
  attachments: [],
};

describe("agent prompts", () => {
  const settings = linearSettings.schema.parse({});
  const project = emptyProjectConfig({ projectId: "p1", displayName: "Shop", rootPath: "/shop" });

  it("adds the project's saved guidance unless the launch passes its own", () => {
    const guided = { ...project, guidance: { updateLinear: false, subagentKeys: false, paseoSubagents: true } };
    const base = { action: "implement" as const, issue: detail, settings, includeComments: false, extraInstructions: "" };
    expect(composePrompt({ ...base, project: guided })).toContain("linear start_agent tool");
    const none = { updateLinear: false, subagentKeys: false, paseoSubagents: false };
    expect(composePrompt({ ...base, project: guided, guidance: none })).not.toContain("Paseo agents");
  });

  it("renders the built-in implement prompt with the issue snapshot and branch", () => {
    const prompt = composePrompt({
      action: "implement",
      issue: detail,
      settings,
      project: null,
      includeComments: true,
      extraInstructions: "",
    });
    expect(prompt).toContain("You are working on Linear issue ENG-123: Plugin attachments");
    expect(prompt).toContain("on branch eng-123-plugin-attachments");
    expect(prompt).toContain("- ada (2026-09-02): Check the composer first.");
  });

  it("appends project text, instructions, numbered steps, and one-off instructions", () => {
    const prompt = composePrompt({
      action: "review",
      issue: detail,
      settings,
      project: {
        ...project,
        instructions: "Use pnpm.",
        steps: ["Run pnpm test", "", " Open a draft PR "],
        review: { mode: "append", text: "Focus on {{identifier}} security." },
      },
      includeComments: false,
      extraInstructions: "Be brief.",
    });
    expect(prompt.startsWith("Review the work for Linear issue ENG-123: Plugin attachments")).toBe(
      true,
    );
    expect(prompt).toContain("Focus on ENG-123 security.");
    expect(prompt).toContain("Project instructions:\nUse pnpm.");
    expect(prompt).toContain("Project steps:\n1. Run pnpm test\n2. Open a draft PR");
    expect(prompt.endsWith("Additional instructions:\nBe brief.")).toBe(true);
    expect(prompt).not.toContain("Comments (oldest first)");
  });

  it("keeps the issue snapshot when a replacement template omits it", () => {
    const prompt = composePrompt({
      action: "implement",
      issue: detail,
      settings,
      project: { ...project, implement: { mode: "replace", text: "Fix {{identifier}} now." } },
      includeComments: false,
      extraInstructions: "",
    });
    expect(prompt.startsWith("Fix ENG-123 now.\n\nLinear issue ENG-123: Plugin attachments")).toBe(
      true,
    );
    expect(prompt).not.toContain("You are working on");
  });

  it("asks implementers for one keyed todo per sub-issue only when sub-issues exist", () => {
    const children = [{ id: "c1", identifier: "ENG-124", title: "Queue", state }];
    const base = { settings, project: null, includeComments: false, extraInstructions: "" };
    const implement = composePrompt({ ...base, action: "implement", issue: { ...detail, children } });
    expect(implement).toContain('Start each todo with its sub-issue key, for example "ENG-124: <task>".');
    const review = composePrompt({ ...base, action: "review", issue: { ...detail, children } });
    expect(review).not.toContain("Start each todo");
    expect(composePrompt({ ...base, action: "implement", issue: detail })).not.toContain(
      "Start each todo",
    );
  });

  it("parses empty settings into complete defaults", () => {
    expect(settings).toEqual({
      templates: { implement: "", review: "" },
      launch: {
        provider: "",
        isolation: "worktree",
        includeComments: true,
        moveToStarted: true,
        assignToMe: true,
      },
      live: {
        enabled: true,
        mapping: "semantic",
        exploreProvider: "",
        exploreEffort: "",
        syncTodos: false,
        view: "map",
        issuesCollapsed: false,
        graphCamera: "auto",
        graphLocked: false,
      },
      access: { allProjects: true, projects: {} },
      projects: [],
      icon: { svg: "", paint: "original", color: "#5E6AD2", solid: false },
    });
  });
});

describe("issue filters", () => {
  it("combines team, assignee, status, and text clauses", () => {
    expect(
      issueFilter({
        teamId: "team-1",
        assignee: "me",
        status: "active",
        query: " crash ",
        after: null,
      }),
    ).toEqual({
      and: [
        { team: { id: { eq: "team-1" } } },
        { assignee: { isMe: { eq: true } } },
        { state: { type: { in: ["unstarted", "started"] } } },
        {
          or: [
            { title: { containsIgnoreCase: "crash" } },
            { description: { containsIgnoreCase: "crash" } },
          ],
        },
      ],
    });
    expect(
      issueFilter({ teamId: null, assignee: "anyone", status: "all", query: "", after: null }),
    ).toBeNull();
  });

  it("jumps straight to an issue key before listing", async () => {
    const queries: string[] = [];
    const service = createLinearService(async (query, variables) => {
      queries.push(
        query.includes("PaseoLinearIssueDetail") ? `detail:${String(variables?.id)}` : "list",
      );
      return {
        issue: {
          ...detail,
          ancestors: null,
          labels: { nodes: [] },
          children: { nodes: [] },
          comments: { nodes: [] },
          attachments: { nodes: [] },
        },
      };
    });
    const result = await service.listIssues({
      teamId: null,
      assignee: "me",
      status: "active",
      query: "eng-123",
      after: null,
    });
    expect(queries).toEqual(["detail:ENG-123"]);
    expect(result.issues.map((entry) => entry.identifier)).toEqual(["ENG-123"]);
  });
});

describe("Linear GraphQL transport", () => {
  it("reports GraphQL errors sent with HTTP 400", async () => {
    await expect(
      withLinearServer(
        (_request, response) => {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ errors: [{ message: "Variable $id is invalid" }] }));
        },
        (endpoint) =>
          createLinearGraphql({ apiKey: "lin_api_test", endpoint })("query { viewer { id } }"),
      ),
    ).rejects.toThrow("Variable $id is invalid");
  });

  it("describes a rejected key without echoing it", async () => {
    await expect(
      withLinearServer(
        (_request, response) => {
          response.writeHead(401, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ errors: [{ message: "Authentication required" }] }));
        },
        (endpoint) =>
          createLinearGraphql({ apiKey: "lin_api_secret", endpoint })("query { viewer { id } }"),
      ),
    ).rejects.toThrow("Linear rejected the API key");
  });
});

describe("credential store", () => {
  it("prefers the saved key, writes it owner-only, and falls back to the environment", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "paseo-linear-"));
    try {
      const file = path.join(directory, "nested", "credentials.json");
      const store = createCredentialStore({ file, env: { LINEAR_API_KEY: "lin_api_env" } });
      expect(await store.resolve()).toEqual({ apiKey: "lin_api_env", source: "environment" });
      await store.save(" lin_api_saved ");
      expect(await store.resolve()).toEqual({ apiKey: "lin_api_saved", source: "file" });
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
        apiKey: "lin_api_saved",
        projects: {},
      });
      if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o600);
      await store.clear();
      expect(await store.resolve()).toEqual({ apiKey: "lin_api_env", source: "environment" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
