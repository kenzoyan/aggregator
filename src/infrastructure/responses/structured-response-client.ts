import { z } from "zod";

const responsesEnvelopeSchema = z.object({
  status: z.string().optional(),
  output: z.array(z.object({
    content: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
    }).passthrough()).optional(),
  }).passthrough()),
}).passthrough();

export type StructuredResponseErrorCode =
  | "authentication-failed"
  | "rate-limited"
  | "invalid-response"
  | "timeout"
  | "service-unavailable";

export class StructuredResponseError extends Error {
  constructor(readonly code: StructuredResponseErrorCode) {
    super(`Structured response failed: ${code}`);
    this.name = "StructuredResponseError";
  }
}

function errorForStatus(status: number): StructuredResponseError {
  if (status === 401 || status === 403) {
    return new StructuredResponseError("authentication-failed");
  }
  if (status === 429) return new StructuredResponseError("rate-limited");
  return new StructuredResponseError("service-unavailable");
}

function parseOutputText(payload: unknown): unknown {
  const response = responsesEnvelopeSchema.parse(payload);
  if (response.status && response.status !== "completed") {
    throw new StructuredResponseError("invalid-response");
  }
  const text = response.output
    .flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")?.text;
  if (!text) throw new StructuredResponseError("invalid-response");
  return JSON.parse(text);
}

export async function requestStructuredResponse<T>(input: {
  endpoint: string;
  apiKey: string;
  model: string;
  instructions: string;
  prompt: unknown;
  schemaName: string;
  jsonSchema: object;
  reasoningEffort: "none" | "medium";
  maxOutputTokens: number;
  timeoutMs: number;
  store?: false;
  parse: (payload: unknown) => T;
  fetch?: typeof globalThis.fetch;
}): Promise<T> {
  try {
    const response = await (input.fetch ?? globalThis.fetch)(input.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        ...(input.store === false ? { store: false } : {}),
        reasoning: { effort: input.reasoningEffort },
        max_output_tokens: input.maxOutputTokens,
        instructions: input.instructions,
        input: input.prompt,
        text: {
          format: {
            type: "json_schema",
            name: input.schemaName,
            strict: true,
            schema: input.jsonSchema,
          },
        },
      }),
      signal: AbortSignal.timeout(input.timeoutMs),
    });
    if (!response.ok) throw errorForStatus(response.status);
    return input.parse(parseOutputText(await response.json()));
  } catch (error) {
    if (error instanceof StructuredResponseError) throw error;
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new StructuredResponseError("timeout");
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      throw new StructuredResponseError("invalid-response");
    }
    throw new StructuredResponseError("service-unavailable");
  }
}
