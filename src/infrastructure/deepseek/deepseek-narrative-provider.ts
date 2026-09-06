import {
  createPortfolioNarrativeInput,
  createPortfolioNarrativeInstructions,
  portfolioNarrativeContentSchema,
  portfolioNarrativeJsonSchema,
  PortfolioNarrativeProviderError,
  type PortfolioNarrativeProvider,
} from "@/application/portfolio-narrative";
import { requestStructuredResponse } from "@/infrastructure/responses/structured-response-client";

export class DeepSeekNarrativeProvider implements PortfolioNarrativeProvider {
  readonly id = "deepseek" as const;
  readonly model: string;
  private readonly apiKey: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(input: {
    apiKey: string;
    model: string;
    fetch?: typeof globalThis.fetch;
  }) {
    this.apiKey = input.apiKey;
    this.model = input.model;
    this.fetch = input.fetch ?? globalThis.fetch;
  }

  async generate(input: Parameters<PortfolioNarrativeProvider["generate"]>[0]) {
    try {
      return await requestStructuredResponse({
        endpoint: "https://api.deepseek.com/responses",
        apiKey: this.apiKey,
        model: this.model,
        reasoningEffort: "none",
        maxOutputTokens: 700,
        timeoutMs: 30_000,
        instructions: createPortfolioNarrativeInstructions(input.language),
        prompt: createPortfolioNarrativeInput(input.insights),
        schemaName: "portfolio_narrative",
        jsonSchema: portfolioNarrativeJsonSchema,
        parse: (payload) => portfolioNarrativeContentSchema.parse(payload),
        fetch: this.fetch,
      });
    } catch (error) {
      if (error instanceof PortfolioNarrativeProviderError) throw error;
      throw new PortfolioNarrativeProviderError("DeepSeek");
    }
  }
}
