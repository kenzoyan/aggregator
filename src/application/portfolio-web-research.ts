import { isIP } from "node:net";

import type { PortfolioAnalystContextV1, PortfolioAnalystLanguage } from "@/application/portfolio-analyst-contract";

export interface WebResearchResult {
  findings: Array<{ title: string; url: string; summary: string }>;
  retrievedAt: string;
  status: "completed" | "unavailable";
}

export interface WebResearch {
  search(input: {
    query: string;
    language: PortfolioAnalystLanguage;
    signal?: AbortSignal;
  }): Promise<WebResearchResult>;
}

export function isWebResearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    return url.protocol === "https:" && !url.username && !url.password &&
      hostname.includes(".") && hostname !== "localhost" &&
      !hostname.endsWith(".localhost") && !hostname.endsWith(".local") &&
      !hostname.endsWith(".test") && !hostname.endsWith(".invalid") &&
      !hostname.endsWith(".example") &&
      isIP(hostname) === 0;
  } catch {
    return false;
  }
}

export function webResearchContext(input: {
  result: WebResearchResult;
  factsAsOf: string;
  language: PortfolioAnalystLanguage;
}): PortfolioAnalystContextV1 {
  return {
    version: "portfolio-analyst-context.v1",
    job: "research-web",
    language: input.language,
    factsAsOf: input.factsAsOf,
    scope: {},
    definitions: {
      baseCurrency: "EUR",
      holdingCurrencyMeaning: "instrument-quoted-currency",
      portfolioActivityMeaning: "estimated-unexplained-value-movement",
    },
    facts: input.result.findings.length > 0
      ? input.result.findings.map((finding, index) => ({
          key: `web.${index + 1}`,
          kind: "web-research-source" as const,
          label: "External source" as const,
          ...finding,
          retrievedAt: input.result.retrievedAt,
          provenance: "openai-web-search" as const,
        }))
      : [{
          key: "web.status",
          kind: "web-research-status",
          label: "Web research status",
          state: input.result.status === "unavailable" ? "unavailable" : "no-verified-source",
          retrievedAt: input.result.retrievedAt,
          provenance: "openai-web-search",
        }],
    limitations: [],
    allowedActions: [],
  };
}
