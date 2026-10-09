import type { PluginServerContext } from "@getpaseo/plugin/server";
import { describe, expect, it } from "vitest";
import type { LinearAccess } from "../server/handlers";
import { registerSync } from "../server/sync";
import type { WorkflowState } from "../shared/linear";
import { linearSettings } from "../shared/settings";

const states: WorkflowState[] = [
  { id: "todo", name: "Todo", type: "unstarted", color: "#ccc", position: 1 },
  { id: "progress", name: "In Progress", type: "started", color: "#fc0", position: 2 },
  { id: "review", name: "In Review", type: "started", color: "#4b8", position: 3 },
  { id: "done", name: "Done", type: "completed", color: "#56d", position: 4 },
];
const at = (id: string) => states.find((state) => state.id === id) as WorkflowState;

function setup(options: {
  syncTodos: boolean;
  labels: Record<string, string>;
  access?: { allProjects: boolean; projects: Record<string, boolean> };
  /** The shop project's own sync switch. */
  shopSync?: boolean;
}) {
  const hooks = new Map<string, (event: unknown, context: unknown) => Promise<void>>();
  const updates: [string, string | undefined][] = [];
  const server = {
    on: (name: string, handler: (event: unknown, context: unknown) => Promise<void>) => {
      hooks.set(name, handler);
      return () => {};
    },
    handle: () => {},
  } as unknown as PluginServerContext;
  const linear = {
    getIssue: async () => ({
      id: "p",
      identifier: "ENG-1",
      state: at("todo"),
      team: { id: "team" },
      children: [{ id: "c", identifier: "ENG-2", title: "Queue", state: at("todo") }],
    }),
    catalog: async () => ({ teams: [{ id: "team", states }] }),
    updateIssue: async (id: string, patch: { stateId?: string }) => {
      updates.push([id, patch.stateId]);
      return {};
    },
  };
  const access = {
    connect: async () => ({ linear, fingerprint: "key" }),
    mutate: async (_projectId: unknown, run: (service: typeof linear) => Promise<unknown>) =>
      run(linear),
  } as unknown as LinearAccess;
  const settings = linearSettings.schema.parse({
    live: { syncTodos: options.syncTodos },
    access: options.access ?? {},
    projects:
      options.shopSync === undefined
        ? []
        : [{ projectId: "shop", displayName: "Shop", rootPath: "/w", overrides: { syncTodos: options.shopSync } }],
  });
  registerSync(server, { access, readSettings: async () => settings });
  const agent = { id: "a1", cwd: "/w", provider: "claude", labels: options.labels, workspaceId: "w1" };
  const paseo = {
    agents: { ref: () => ({ refresh: async () => null, current: () => agent }) },
    workspaces: { ref: () => ({ refresh: async () => ({ projectId: "shop" }) }) },
  };
  const turnEnded = (items: unknown[]) =>
    hooks.get("agent.turn_ended")?.({ agent: { id: "a1" }, timeline: items }, { paseo });
  return { turnEnded, updates };
}

const todos = {
  type: "todo",
  items: [{ text: "ENG-2: build the queue", completed: true, status: "completed" }],
};
const implement = { "linear.issue": "ENG-1", "linear.action": "implement" };

describe("todo sync hook", () => {
  it("moves the sub-issue to Done and the parent to In Review", async () => {
    const { turnEnded, updates } = setup({ syncTodos: true, labels: implement });
    await turnEnded([todos]);
    expect(updates).toEqual([
      ["c", "done"],
      ["p", "review"],
    ]);
  });

  it("does nothing when sync is off, for reviewers, or for the plugin's own agents", async () => {
    for (const [syncTodos, labels] of [
      [false, implement],
      [true, { ...implement, "linear.action": "review" }],
      [true, { ...implement, "linear.explore": "ENG-1" }],
    ] as const) {
      const { turnEnded, updates } = setup({ syncTodos, labels });
      await turnEnded([todos]);
      expect(updates).toEqual([]);
    }
  });

  it("does nothing in a project where Linear is off", async () => {
    const cases: { allProjects: boolean; projects: Record<string, boolean> }[] = [
      { allProjects: true, projects: { shop: false } },
      { allProjects: false, projects: {} },
    ];
    for (const access of cases) {
      const { turnEnded, updates } = setup({ syncTodos: true, labels: implement, access });
      await turnEnded([todos]);
      expect(updates).toEqual([]);
    }
  });

  it("follows the project's own sync switch over the switch for all projects", async () => {
    const on = setup({ syncTodos: false, shopSync: true, labels: implement });
    await on.turnEnded([todos]);
    expect(on.updates).toHaveLength(2);
    const off = setup({ syncTodos: true, shopSync: false, labels: implement });
    await off.turnEnded([todos]);
    expect(off.updates).toEqual([]);
  });
});
