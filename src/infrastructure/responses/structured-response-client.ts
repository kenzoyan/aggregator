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

function parseResponsePayload(payload: unknown): {
  outputText: unknown;
  responseEnvelope: unknown;
} {
  const response = responsesEnvelopeSchema.parse(payload);
  if (response.status && response.status !== "completed") {
    throw new StructuredResponseError("invalid-response");
  }
  const text = response.output
    .flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")?.text;
  if (!text) throw new StructuredResponseError("invalid-response");
  return {
    outputText: JSON.parse(text),
    responseEnvelope: payload,
  };
}

async function parseStreamingOutput<T>(
  response: Response,
  parse: (payload: unknown) => T,
  projection: {
    project: (partialOutputText: string) => string | undefined;
    onDelta: (delta: string) => void;
  },
): Promise<T> {
  if (!response.body) throw new StructuredResponseError("invalid-response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let outputText = "";
  let emittedProjectedText = "";

  function consume(line: string) {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as { type?: string; delta?: unknown };
    if (event.type !== "response.output_text.delta" || typeof event.delta !== "string") {
      return;
    }
    outputText += event.delta;
    const projectedText = projection.project(outputText);
    if (projectedText?.startsWith(emittedProjectedText)) {
      const delta = projectedText.slice(emittedProjectedText.length);
      if (delta) {
        emittedProjectedText = projectedText;
        projection.onDelta(delta);
      }
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
    if (done) break;
  }
  if (buffer) consume(buffer);
  return parse(JSON.parse(outputText));
}

export async function requestStructuredResponse<T>(input: {
  endpoint: string;
  apiKey: string;
  model: string;
  instructions: string;
  prompt: unknown;
  schemaName: string;
  jsonSchema: object;
  reasoningEffort?: "none" | "medium";
  maxOutputTokens?: number;
  timeoutMs: number;
  store?: false;
  tools?: ReadonlyArray<Record<string, unknown>>;
  toolChoice?: string;
  maxToolCalls?: number;
  include?: readonly string[];
  signal?: AbortSignal;
  streamProjection?: {
    project: (partialOutputText: string) => string | undefined;
    onDelta: (delta: string) => void;
  };
  parse: (payload: unknown, responseEnvelope: unknown) => T;
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
        ...(input.reasoningEffort ? { reasoning: { effort: input.reasoningEffort } } : {}),
        ...(input.maxOutputTokens === undefined ? {} : { max_output_tokens: input.maxOutputTokens }),
        instructions: input.instructions,
        input: input.prompt,
        ...(input.tools ? { tools: input.tools } : {}),
        ...(input.toolChoice ? { tool_choice: input.toolChoice } : {}),
        ...(input.maxToolCalls === undefined ? {} : { max_tool_calls: input.maxToolCalls }),
        ...(input.include ? { include: input.include } : {}),
        ...(input.streamProjection ? { stream: true } : {}),
        text: {
          format: {
            type: "json_schema",
            name: input.schemaName,
            strict: true,
            schema: input.jsonSchema,
          },
        },
      }),
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)])
        : AbortSignal.timeout(input.timeoutMs),
    });
    if (!response.ok) throw errorForStatus(response.status);
    if (input.streamProjection) {
      return await parseStreamingOutput(
        response,
        (payload) => input.parse(payload, undefined),
        input.streamProjection,
      );
    }
    const parsedResponse = parseResponsePayload(await response.json());
    return input.parse(parsedResponse.outputText, parsedResponse.responseEnvelope);
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
