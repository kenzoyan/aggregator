import type { PortfolioAnalystProvider } from "@/application/portfolio-analyst-provider";
import { requestPortfolioAnalystAnswer } from "@/infrastructure/responses/portfolio-analyst-response";

export class DeepSeekAnalystProvider implements PortfolioAnalystProvider {
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

  generate(
    context: Parameters<PortfolioAnalystProvider["generate"]>[0],
    turn?: Parameters<PortfolioAnalystProvider["generate"]>[1],
  ) {
    return requestPortfolioAnalystAnswer({
      endpoint: "https://api.deepseek.com/responses",
      apiKey: this.apiKey,
      model: this.model,
      providerName: "DeepSeek",
      context,
      turn,
      fetch: this.fetch,
    });
  }
}
