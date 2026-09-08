import type { PortfolioAnalystProvider } from "@/application/portfolio-analyst-provider";
import { requestPortfolioAnalystAnswer } from "@/infrastructure/responses/portfolio-analyst-response";

export class OpenAIAnalystProvider implements PortfolioAnalystProvider {
  readonly id = "openai" as const;
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

  generate(context: Parameters<PortfolioAnalystProvider["generate"]>[0]) {
    return requestPortfolioAnalystAnswer({
      endpoint: "https://api.openai.com/v1/responses",
      apiKey: this.apiKey,
      model: this.model,
      providerName: "OpenAI",
      context,
      store: false,
      fetch: this.fetch,
    });
  }
}
