import {
  createPortfolioNarrativeInput,
  createPortfolioNarrativeInstructions,
  parsePortfolioNarrativeResponse,
  portfolioNarrativeJsonSchema,
  PortfolioNarrativeProviderError,
  type PortfolioNarrativeProvider,
} from "@/application/portfolio-narrative";

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
      const response = await this.fetch("https://api.deepseek.com/responses", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          reasoning: { effort: "none" },
          max_output_tokens: 700,
          instructions: createPortfolioNarrativeInstructions(input.language),
          input: createPortfolioNarrativeInput(input.insights),
          text: {
            format: {
              type: "json_schema",
              name: "portfolio_narrative",
              strict: true,
              schema: portfolioNarrativeJsonSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
      return parsePortfolioNarrativeResponse(await response.json());
    } catch (error) {
      if (error instanceof PortfolioNarrativeProviderError) throw error;
      throw new PortfolioNarrativeProviderError("DeepSeek");
    }
  }
}
