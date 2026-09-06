import { z } from "zod";

import {
  createVisionExtractionInstructions,
  screenshotExtractionJsonSchema,
  screenshotExtractionSchema,
  VisionExtractionError,
  type ScreenshotExtraction,
  type VisionExtractionRequest,
  type VisionExtractor,
} from "@/application/imports/vision-extractor";

const openAIResponseSchema = z.object({
  status: z.string().optional(),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
    }).passthrough()).optional(),
  }).passthrough()),
}).passthrough();

function outputText(payload: unknown): string {
  const response = openAIResponseSchema.parse(payload);
  if (response.status && response.status !== "completed") {
    throw new VisionExtractionError("invalid-response");
  }
  const text = response.output
    .flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")?.text;
  if (!text) throw new VisionExtractionError("invalid-response");
  return text;
}

function responseError(status: number): VisionExtractionError {
  if (status === 401 || status === 403) {
    return new VisionExtractionError("authentication-failed");
  }
  if (status === 429) return new VisionExtractionError("rate-limited");
  return new VisionExtractionError("service-unavailable");
}

export class OpenAIVisionExtractor implements VisionExtractor {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(input: {
    apiKey: string;
    model: string;
    fetch?: typeof globalThis.fetch;
  }) {
    if (!input.apiKey.trim()) throw new VisionExtractionError("not-configured");
    this.apiKey = input.apiKey;
    this.model = input.model;
    this.fetch = input.fetch ?? globalThis.fetch;
  }

  async extract(request: VisionExtractionRequest): Promise<ScreenshotExtraction> {
    try {
      const image = Buffer.from(request.image).toString("base64");
      const response = await this.fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          reasoning: { effort: "medium" },
          max_output_tokens: 4_000,
          instructions: createVisionExtractionInstructions(),
          input: [{
            role: "user",
            content: [
              {
                type: "input_text",
                text: request.sourceAccountHint
                  ? `Trusted account context: ${request.sourceAccountHint}`
                  : "Extract the portfolio holdings shown in this screenshot.",
              },
              {
                type: "input_image",
                image_url: `data:${request.mimeType};base64,${image}`,
                detail: "original",
              },
            ],
          }],
          text: {
            format: {
              type: "json_schema",
              name: "portfolio_screenshot_extraction",
              strict: true,
              schema: screenshotExtractionJsonSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw responseError(response.status);
      return screenshotExtractionSchema.parse(
        JSON.parse(outputText(await response.json())),
      );
    } catch (error) {
      if (error instanceof VisionExtractionError) throw error;
      if (
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError")
      ) {
        throw new VisionExtractionError("timeout");
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        throw new VisionExtractionError("invalid-response");
      }
      throw new VisionExtractionError("service-unavailable");
    }
  }
}
