import { describe, expect, it } from "vitest";

import { createPortfolioNarrativeHandlers } from "@/app/api/portfolio/narrative/route";
import type {
  PortfolioNarrativeProvider,
} from "@/application/portfolio-narrative";
import type { PortfolioInsightsReadModel } from "@/application/portfolio-read-model";

const insights: PortfolioInsightsReadModel = {
  asOf: "2026-08-30T18:00:00.000Z",
  summary: {
    investmentPositionCount: 1,
    sourceAccountCount: 1,
    topHolding: {
      id: "synthetic:fund",
      name: "Synthetic Fund",
      valueEur: 100,
      sharePercent: 100,
    },
    topThreeSharePercent: 100,
  },
  holdingCurrencyAllocation: [
    { currency: "EUR", valueEur: 100, sharePercent: 100, holdingCount: 1 },
  ],
  categoryAllocation: [
    { category: "Fund", valueEur: 100, sharePercent: 100, holdingCount: 1 },
  ],
  performance: {
    today: {
      available: true,
      changeEur: 1,
      percent: 1,
      priceChangeEur: 1,
      fxChangeEur: 0,
    },
    week: {
      available: false,
      changeEur: 0,
      percent: 0,
      priceChangeEur: 0,
      fxChangeEur: 0,
    },
    month: {
      available: false,
      changeEur: 0,
      percent: 0,
      priceChangeEur: 0,
      fxChangeEur: 0,
    },
  },
  dataQuality: {
    valuedHoldingCount: 1,
    freshCount: 1,
    manualCount: 0,
    staleCount: 0,
    awaitingNavCount: 0,
    missingInputCount: 0,
    availablePerformancePeriods: ["today"],
  },
};

function fakeProvider(id: "openai" | "deepseek"): PortfolioNarrativeProvider {
  return {
    id,
    model: id === "openai" ? "gpt-synthetic" : "deepseek-synthetic",
    generate: async () => ({
      headline: "A factual headline",
      overview: "A factual overview.",
      observations: ["One factual observation."],
      dataQuality: "All valued data is current.",
    }),
  };
}

describe("/api/portfolio/narrative", () => {
  it("reports configuration without exposing credentials", async () => {
    const handlers = createPortfolioNarrativeHandlers({
      providers: { openai: fakeProvider("openai") },
      models: {
        openai: "gpt-synthetic",
        deepseek: "deepseek-synthetic",
      },
      defaultProvider: "openai",
    });

    const response = await handlers.GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      defaultProvider: "openai",
      providers: [
        { id: "openai", configured: true, model: "gpt-synthetic" },
        { id: "deepseek", configured: false, model: "deepseek-synthetic" },
      ],
    });
    expect(JSON.stringify(await handlers.GET().then((item) => item.json())))
      .not.toContain("key");
  });

  it("generates on demand and adds non-model metadata", async () => {
    let received: unknown;
    const provider = fakeProvider("deepseek");
    provider.generate = async (input) => {
      received = input;
      return {
        headline: "A factual headline",
        overview: "A factual overview.",
        observations: ["One factual observation."],
        dataQuality: "All valued data is current.",
      };
    };
    const handlers = createPortfolioNarrativeHandlers({
      providers: { deepseek: provider },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "deepseek",
      now: () => "2026-08-30T18:30:00.000Z",
    });
    const response = await handlers.POST(new Request(
      "http://localhost/api/portfolio/narrative",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "deepseek", language: "zh-CN", insights }),
      },
    ));

    expect(response.status).toBe(200);
    expect(received).toEqual({ insights, language: "zh-CN" });
    await expect(response.json()).resolves.toEqual({
      narrative: {
        provider: "deepseek",
        model: "deepseek-synthetic",
        language: "zh-CN",
        generatedAt: "2026-08-30T18:30:00.000Z",
        headline: "A factual headline",
        overview: "A factual overview.",
        observations: ["One factual observation."],
        dataQuality: "All valued data is current.",
        disclaimer: "AI-generated factual summary · Not investment advice",
      },
    });
  });

  it("rejects invalid facts and identifies an unconfigured provider", async () => {
    const handlers = createPortfolioNarrativeHandlers({
      providers: {},
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    });
    const invalid = await handlers.POST(new Request(
      "http://localhost/api/portfolio/narrative",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", language: "en", insights: {} }),
      },
    ));
    expect(invalid.status).toBe(400);

    const unavailable = await handlers.POST(new Request(
      "http://localhost/api/portfolio/narrative",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", language: "en", insights }),
      },
    ));
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({
      error: "OpenAI is not configured. Add its API key to .env.local.",
      code: "provider-not-configured",
    });
  });
});
