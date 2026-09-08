import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type {
  AnalystEvidenceFact,
  PortfolioAnalystContextV1,
} from "@/application/portfolio-analyst-context";

export const portfolioAnalystProviderIds = ["openai", "deepseek"] as const;
export type PortfolioAnalystProviderId = typeof portfolioAnalystProviderIds[number];

export interface PortfolioAnalystProvider {
  readonly id: PortfolioAnalystProviderId;
  readonly model: string;
  generate(context: PortfolioAnalystContextV1): Promise<PortfolioAnalystAnswer>;
}

export interface PortfolioAnalystReport {
  provider: PortfolioAnalystProviderId;
  model: string;
  generatedAt: string;
  contextVersion: PortfolioAnalystContextV1["version"];
  job: PortfolioAnalystContextV1["job"];
  language: PortfolioAnalystContextV1["language"];
  scope: PortfolioAnalystContextV1["scope"];
  factsAsOf: string;
  answer: PortfolioAnalystAnswer;
  evidence: AnalystEvidenceFact[];
  disclaimer: string;
}

export type PortfolioAnalystProviderErrorCode =
  | "provider-unavailable"
  | "invalid-provider-output";

export class PortfolioAnalystProviderError extends Error {
  constructor(
    readonly code: PortfolioAnalystProviderErrorCode,
    providerName: string,
  ) {
    super(code === "invalid-provider-output"
      ? `${providerName} returned an invalid portfolio analyst answer.`
      : `${providerName} could not generate a portfolio analyst answer.`);
    this.name = "PortfolioAnalystProviderError";
  }
}
