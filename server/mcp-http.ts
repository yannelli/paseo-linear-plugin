import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { type ZodType, z } from "zod";

// A small MCP server over HTTP for agents on this host. It sends plain JSON responses, which the
// streamable HTTP transport allows, so it needs no sessions and no event streams.

export interface McpTool<C> {
  name: string;
  description: string;
  input: ZodType;
  /** Callers that may list and call the tool; all callers when absent. */
  allowed?(caller: C): boolean;
  run(input: unknown, caller: C): Promise<string>;
}

/** A tool whose run gets its parsed input. */
export function tool<S extends ZodType, C>(
  definition: Omit<McpTool<C>, "input" | "run"> & { input: S; run(input: z.output<S>, caller: C): Promise<string> },
): McpTool<C> {
  return definition as unknown as McpTool<C>;
}

export interface McpOptions<C> {
  name: string;
  version: string;
  tools: readonly McpTool<C>[];
  /** The caller for a bearer token, or null to refuse the request. */
  authorize(token: string): Promise<C | null>;
  /** Why the caller gets no tools at all, or null. The tool list is then empty. */
  closed?(caller: C): string | null;
}

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_BODY = 1_000_000;

type Message = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

const failure = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const success = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const text = (value: string, isError = false) => ({ content: [{ type: "text", text: value }], ...(isError ? { isError } : {}) });

function errorText(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
  return error instanceof Error ? error.message : String(error);
}

/** The answer to one JSON-RPC message, or null for a notification. */
export async function answer<C>(options: McpOptions<C>, message: Message, caller: C): Promise<object | null> {
  if (typeof message !== "object" || message === null || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return failure(message?.id, -32600, "Invalid request");
  }
  if (message.id === undefined || message.id === null) return null;
  const params = (typeof message.params === "object" && message.params !== null ? message.params : {}) as Record<string, unknown>;
  const closed = options.closed?.(caller) ?? null;
  const tools = closed ? [] : options.tools.filter((tool) => tool.allowed?.(caller) ?? true);
  switch (message.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return success(message.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: options.name, version: options.version },
      });
    }
    case "ping":
      return success(message.id, {});
    case "tools/list":
      return success(message.id, {
        tools: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: z.toJSONSchema(tool.input, { io: "input" }),
        })),
      });
    case "tools/call": {
      if (closed) return success(message.id, text(closed, true));
      const tool = tools.find((entry) => entry.name === params.name);
      if (!tool) return failure(message.id, -32602, `Unknown tool: ${String(params.name)}`);
      try {
        return success(message.id, text(await tool.run(tool.input.parse(params.arguments ?? {}), caller)));
      } catch (error) {
        return success(message.id, text(errorText(error), true));
      }
    }
    default:
      return failure(message.id, -32601, `Unknown method: ${message.method}`);
  }
}

function readBody(request: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        resolve(null);
        request.destroy();
      } else chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function send(response: ServerResponse, status: number, body?: unknown) {
  response.writeHead(status, body === undefined ? {} : { "content-type": "application/json" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

// Browsers send an Origin header and agents do not, so a web page can never reach the tools.
export function createMcpServer<C>(options: McpOptions<C>): Server {
  return createServer(async (request, response) => {
    try {
      if (new URL(request.url ?? "/", "http://localhost").pathname !== "/mcp") return send(response, 404);
      if (request.headers.origin) return send(response, 403);
      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        return send(response, 405);
      }
      const token = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "")?.[1];
      const caller = token ? await options.authorize(token) : null;
      if (caller === null) return send(response, 401, failure(null, -32001, "Unknown token"));
      const raw = await readBody(request);
      if (raw === null) return send(response, 413);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return send(response, 400, failure(null, -32700, "Parse error"));
      }
      const messages = (Array.isArray(parsed) ? parsed : [parsed]) as Message[];
      const answers = (await Promise.all(messages.map((message) => answer(options, message, caller)))).filter(Boolean);
      if (answers.length === 0) return send(response, 202);
      send(response, 200, Array.isArray(parsed) ? answers : answers[0]);
    } catch (error) {
      console.error("Linear MCP request failed", error);
      if (!response.headersSent) send(response, 500);
    }
  });
}

/** Listens on 127.0.0.1, on the preferred port when it is free. Returns the port. */
export function listenLocal(server: Server, preferred: number | null): Promise<number> {
  const attempt = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const fail = (error: Error) => reject(error);
      server.once("error", fail);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", fail);
        resolve((server.address() as AddressInfo).port);
      });
    });
  return preferred ? attempt(preferred).catch(() => attempt(0)) : attempt(0);
}
