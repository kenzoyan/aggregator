import {
  createVisionExtractionInstructions,
  screenshotExtractionJsonSchema,
  screenshotExtractionSchema,
  VisionExtractionError,
  type ScreenshotExtraction,
  type VisionExtractionRequest,
  type VisionExtractor,
} from "@/application/imports/vision-extractor";
import {
  requestStructuredResponse,
  StructuredResponseError,
} from "@/infrastructure/responses/structured-response-client";

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
      if (request.images.length === 0) {
        throw new VisionExtractionError("invalid-response");
      }
      return await requestStructuredResponse({
        endpoint: "https://api.openai.com/v1/responses",
        apiKey: this.apiKey,
        model: this.model,
        store: false,
        reasoningEffort: "medium",
        maxOutputTokens: 4_000,
        timeoutMs: 60_000,
        instructions: createVisionExtractionInstructions(),
        prompt: [{
            role: "user",
            content: [
              {
                type: "input_text",
                text: request.sourceAccountHint
                  ? `The user-selected Source Account is authoritative: ${request.sourceAccountHint}. Do not infer a different provider from ambiguous branding or holding names; report a different accountName only when the screenshots explicitly show it. Combine all ${request.images.length} screenshots into one account snapshot.`
                  : `Combine all ${request.images.length} screenshots into one account snapshot.`,
              },
              ...request.images.map((image) => ({
                type: "input_image",
                image_url: `data:${image.mimeType};base64,${Buffer.from(image.image).toString("base64")}`,
                detail: "original",
              })),
            ],
          }],
        schemaName: "portfolio_screenshot_extraction",
        jsonSchema: screenshotExtractionJsonSchema,
        parse: (payload) => screenshotExtractionSchema.parse(payload),
        fetch: this.fetch,
      });
    } catch (error) {
      if (error instanceof VisionExtractionError) throw error;
      if (error instanceof StructuredResponseError) {
        throw new VisionExtractionError(error.code);
      }
      throw new VisionExtractionError("service-unavailable");
    }
  }
}
