import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type { PortfolioAnalystAnswerValidationCode } from "@/application/portfolio-analyst-answer";
import type {
  AnalystEvidenceFact,
  PortfolioAnalystContextV1,
} from "@/application/portfolio-analyst-contract";
import type { PortfolioAnalystAgentAudit } from "@/application/portfolio-analyst-agent";

export const portfolioAnalystProviderIds = ["openai"] as const;
export type PortfolioAnalystProviderId = typeof portfolioAnalystProviderIds[number];

export interface PortfolioAnalystReport {
  provider: string;
  model: string;
  generatedAt: string;
  contextVersion: PortfolioAnalystContextV1["version"];
  job: PortfolioAnalystContextV1["job"];
  language: PortfolioAnalystContextV1["language"];
  scope: PortfolioAnalystContextV1["scope"];
  factsAsOf: string;
  answer: PortfolioAnalystAnswer;
  evidence: AnalystEvidenceFact[];
  agentAudit?: PortfolioAnalystAgentAudit;
  disclaimer: string;
}

export type PortfolioAnalystProviderErrorCode =
  | "provider-unavailable"
  | "invalid-provider-output";

export class PortfolioAnalystProviderError extends Error {
  constructor(
    readonly code: PortfolioAnalystProviderErrorCode,
    providerName: string,
    readonly diagnosticCode?: PortfolioAnalystAnswerValidationCode | "invalid-json" | "invalid-structure" |
      "timeout" | "rate-limited" | "authentication" | "request-rejected" | "network" | "unknown",
  ) {
    super(code === "invalid-provider-output"
      ? `${providerName} returned an invalid portfolio analyst answer.`
      : `${providerName} could not generate a portfolio analyst answer.`);
    this.name = "PortfolioAnalystProviderError";
  }
}
