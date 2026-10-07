import { z } from "zod";

export const LINEAR_ENDPOINT = "https://api.linear.app/graphql";

export class LinearApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinearApiError";
  }
}

export interface LinearGraphqlOptions {
  apiKey: string;
  endpoint?: string;
  request?: typeof fetch;
}

export type LinearGraphql = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<unknown>;

const GraphqlEnvelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(z.object({ message: z.string() }).passthrough()).optional(),
});

function describeHttpFailure(status: number): string {
  if (status === 401 || status === 403) return "Linear rejected the API key";
  if (status === 429) return "Linear rate limit reached. Try again shortly";
  return `Linear API request failed with HTTP ${status}`;
}

export function createLinearGraphql(options: LinearGraphqlOptions): LinearGraphql {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new LinearApiError("Connect Linear: add an API key in Linear settings");
  const endpoint = options.endpoint ?? LINEAR_ENDPOINT;
  const request = options.request ?? fetch;

  return async (query, variables = {}) => {
    const response = await request(endpoint, {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    // Linear reports auth and validation failures as HTTP 400 with GraphQL errors.
    const text = await response.text();
    let body: z.infer<typeof GraphqlEnvelopeSchema> | null = null;
    try {
      body = GraphqlEnvelopeSchema.parse(JSON.parse(text));
    } catch {
      body = null;
    }
    if (body?.errors && body.errors.length > 0) {
      const message = body.errors.map((error) => error.message).join("; ");
      throw new LinearApiError(
        response.status === 401 || response.status === 403
          ? describeHttpFailure(response.status)
          : message,
      );
    }
    if (!response.ok) throw new LinearApiError(describeHttpFailure(response.status));
    if (!body || body.data === undefined || body.data === null) {
      throw new LinearApiError("Linear returned no data");
    }
    return body.data;
  };
}
