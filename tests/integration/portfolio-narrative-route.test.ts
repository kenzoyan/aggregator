import { describe, expect, it } from "vitest";

import { createPortfolioNarrativeHandlers } from "@/app/api/portfolio/narrative/handler";
import type {
  PortfolioNarrativeReport,
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

function fakeProvider(id: "openai"): PortfolioNarrativeProvider {
  return {
    id,
    model: "gpt-synthetic",
    generate: async () => ({
      headline: { text: "A factual headline", evidence: ["composition"] },
      overview: {
        text: "A factual overview.",
        evidence: ["composition", "holding-currency"],
      },
      observations: [{
        text: "One factual observation.",
        evidence: ["performance-today"],
      }],
      dataQuality: {
        text: "All valued data is current.",
        evidence: ["data-quality"],
      },
    }),
  };
}

function createNarrativeStore(initial?: PortfolioNarrativeReport) {
  let latest = initial;
  return {
    savePortfolioNarrative(report: PortfolioNarrativeReport) {
      latest = report;
    },
    readLatestPortfolioNarrative() {
      return latest;
    },
  };
}

describe("/api/portfolio/narrative", () => {
  it("reports configuration without exposing credentials", async () => {
    const handlers = createPortfolioNarrativeHandlers({
      providers: { openai: fakeProvider("openai") },
      models: {
        openai: "gpt-synthetic",
      },
      defaultProvider: "openai",
    }, {
      database: createNarrativeStore(),
      readCurrentInsights: () => insights,
    });

    const response = await handlers.GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      defaultProvider: "openai",
      providers: [
        { id: "openai", configured: true, model: "gpt-synthetic" },
      ],
    });
    expect(JSON.stringify(await handlers.GET().then((item) => item.json())))
      .not.toContain("key");
  });

  it("generates on demand and adds non-model metadata", async () => {
    let received: unknown;
    const provider = fakeProvider("openai");
    provider.generate = async (input) => {
      received = input;
      return {
        headline: { text: "A factual headline", evidence: ["composition"] },
        overview: {
          text: "A factual overview.",
          evidence: ["composition", "holding-currency"],
        },
        observations: [{
          text: "One factual observation.",
          evidence: ["performance-today"],
        }],
        dataQuality: {
          text: "All valued data is current.",
          evidence: ["data-quality"],
        },
      };
    };
    const store = createNarrativeStore();
    const handlers = createPortfolioNarrativeHandlers({
      providers: { openai: provider },
      models: { openai: "gpt-synthetic" },
      defaultProvider: "openai",
    }, {
      database: store,
      now: () => "2026-08-30T18:30:00.000Z",
      createId: () => "narrative-synthetic",
      readCurrentInsights: () => insights,
    });
    const response = await handlers.POST(new Request(
      "http://localhost/api/portfolio/narrative",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", language: "zh-CN" }),
      },
    ));

    expect(response.status).toBe(200);
    expect(received).toEqual({ insights, language: "zh-CN" });
    await expect(response.json()).resolves.toEqual({
      narrative: {
        id: "narrative-synthetic",
        provider: "openai",
        model: "gpt-synthetic",
        language: "zh-CN",
        generatedAt: "2026-08-30T18:30:00.000Z",
        portfolioAsOf: "2026-08-30T18:00:00.000Z",
        factsFingerprint: expect.stringMatching(/^v1-[a-f0-9]{16}$/),
        headline: { text: "A factual headline", evidence: ["composition"] },
        overview: {
          text: "A factual overview.",
          evidence: ["composition", "holding-currency"],
        },
        observations: [{
          text: "One factual observation.",
          evidence: ["performance-today"],
        }],
        dataQuality: {
          text: "All valued data is current.",
          evidence: ["data-quality"],
        },
        provenance: [
          expect.objectContaining({ key: "composition" }),
          expect.objectContaining({ key: "holding-currency" }),
          expect.objectContaining({ key: "performance-today" }),
          expect.objectContaining({ key: "data-quality" }),
        ],
        disclaimer: "AI-generated factual summary · Not investment advice",
      },
    });
    expect(store.readLatestPortfolioNarrative()).toEqual(
      expect.objectContaining({ id: "narrative-synthetic" }),
    );
    await expect(handlers.GET().then((item) => item.json())).resolves.toEqual(
      expect.objectContaining({
        latestNarrative: expect.objectContaining({ id: "narrative-synthetic" }),
      }),
    );
  });

  it("rejects invalid requests and identifies an unconfigured provider", async () => {
    const handlers = createPortfolioNarrativeHandlers({
      providers: {},
      models: { openai: "gpt-synthetic" },
      defaultProvider: "openai",
    }, {
      database: createNarrativeStore(),
      readCurrentInsights: () => insights,
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

    const retiredProvider = await handlers.POST(new Request(
      "http://localhost/api/portfolio/narrative",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "retired-provider", language: "en" }),
      },
    ));
    expect(retiredProvider.status).toBe(400);

    const unavailable = await handlers.POST(new Request(
      "http://localhost/api/portfolio/narrative",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", language: "en" }),
      },
    ));
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toEqual({
      error: "OpenAI is not configured. Add its API key to .env.local.",
      code: "provider-not-configured",
    });
  });

  it("does not call a provider when the local portfolio is empty", async () => {
    let calls = 0;
    const provider = fakeProvider("openai");
    provider.generate = async () => {
      calls += 1;
      throw new Error("should not be called");
    };
    const handlers = createPortfolioNarrativeHandlers({
      providers: { openai: provider },
      models: { openai: "gpt-synthetic" },
      defaultProvider: "openai",
    }, {
      database: createNarrativeStore(),
      readCurrentInsights: () => undefined,
    });
    const response = await handlers.POST(new Request(
      "http://localhost/api/portfolio/narrative",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", language: "en" }),
      },
    ));

    expect(calls).toBe(0);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "No current portfolio facts are available.",
      code: "portfolio-empty",
    });
  });

  it("distinguishes a local persistence failure from a provider failure", async () => {
    const handlers = createPortfolioNarrativeHandlers({
      providers: { openai: fakeProvider("openai") },
      models: { openai: "gpt-synthetic" },
      defaultProvider: "openai",
    }, {
      database: {
        readLatestPortfolioNarrative: () => undefined,
        savePortfolioNarrative: () => {
          throw new Error("synthetic database detail");
        },
      },
      readCurrentInsights: () => insights,
    });
    const response = await handlers.POST(new Request(
      "http://localhost/api/portfolio/narrative",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "openai", language: "en" }),
      },
    ));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "The narrative was generated but could not be saved locally.",
      code: "narrative-storage-failed",
    });
  });
});
