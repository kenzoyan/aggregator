import { describe, expect, it } from "vitest";

import { createPortfolioAnalystHandlers } from "@/app/api/portfolio/analyst/route";
import type { PortfolioAnalystContextV1 } from "@/application/portfolio-analyst-context";
import type { PortfolioAnalystProvider } from "@/application/portfolio-analyst-provider";
import { PortfolioAnalystProviderError } from "@/application/portfolio-analyst-provider";
import type {
  PortfolioInsightsReadModel,
  PortfolioOverviewReadModel,
} from "@/application/portfolio-read-model";

function portfolio(): PortfolioOverviewReadModel & { insights: PortfolioInsightsReadModel } {
  const performance = {
    available: true,
    change: 10,
    percent: 11.11,
    points: [90, 100],
    priceChange: 8,
    fxChange: 2,
    baselineAsOf: "2026-09-01",
    currentAsOf: "2026-09-08",
  };
  return {
    holdings: [{
      id: "private-account:private-instrument",
      sourceAccountId: "private-account",
      holdingKey: {
        sourceAccountId: "private-account",
        instrumentId: "private-instrument",
      },
      name: "Synthetic Fund",
      analystDisplayName: "Synthetic Fund",
      symbol: "PRIVATE-ISIN",
      source: "Private Account",
      category: "Fund",
      currency: "EUR",
      originalValue: "EUR 100",
      eurValue: 100,
      changeEur: 10,
      changePercent: 11.11,
      freshness: "fresh",
      asOf: "2026-09-08",
      detail: {
        quantity: "private quantity",
        costBasis: "private cost basis",
        reportedPriorReturn: "private return",
        currentPrice: "private price",
        currentPriceAsOf: "2026-09-08",
        priceHistory: [],
      },
      history: {
        today: performance,
        week: performance,
        month: performance,
      },
    }],
    totalValueEur: 100,
    accountAllocation: [],
    fxAsOf: "2026-09-08",
    missingInputs: [],
    marketData: { refreshHistory: [] },
    history: {
      today: performance,
      week: performance,
      month: performance,
    },
    insights: {
      asOf: "2026-09-08T10:00:00.000Z",
      summary: {
        investmentPositionCount: 1,
        sourceAccountCount: 1,
        topThreeSharePercent: 100,
      },
      holdingCurrencyAllocation: [],
      categoryAllocation: [],
      performance: {
        today: { available: true, changeEur: 10, percent: 11.11, priceChangeEur: 8, fxChangeEur: 2 },
        week: { available: true, changeEur: 10, percent: 11.11, priceChangeEur: 8, fxChangeEur: 2 },
        month: { available: true, changeEur: 10, percent: 11.11, priceChangeEur: 8, fxChangeEur: 2 },
      },
      dataQuality: {
        valuedHoldingCount: 1,
        freshCount: 1,
        manualCount: 0,
        staleCount: 0,
        awaitingNavCount: 0,
        missingInputCount: 0,
        availablePerformancePeriods: ["today", "week", "month"],
      },
    },
  };
}

function provider(
  generate?: PortfolioAnalystProvider["generate"],
): PortfolioAnalystProvider {
  return {
    id: "openai",
    model: "gpt-synthetic",
    generate: generate ?? (async (context) => ({
      factsAsOf: context.factsAsOf,
      answer: {
        text: "Synthetic factual answer.",
        classification: "fact",
        evidence: [context.job === "explain-period-drivers"
          ? "period.total"
          : "quality.summary"],
      },
      claims: [],
      limitations: context.limitations,
      proposedUpdate: null,
    })),
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/portfolio/analyst", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/portfolio/analyst", () => {
  it("directly calls the period tool, then returns only cited evidence", async () => {
    let received: PortfolioAnalystContextV1 | undefined;
    const handlers = createPortfolioAnalystHandlers({
      providers: { openai: provider(async (context) => {
        received = context;
        return provider().generate(context);
      }) },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, {
      readCurrentPortfolio: portfolio,
      now: () => "2026-09-08T10:05:00.000Z",
    });

    const response = await handlers.POST(request({
      provider: "openai",
      job: "explain-period-drivers",
      period: "week",
      language: "en",
      includeHoldingNames: true,
    }));

    expect(response.status).toBe(200);
    await expect(handlers.GET().then((item) => item.json())).resolves.toEqual({
      defaultProvider: "openai",
      providers: [
        { id: "openai", configured: true, model: "gpt-synthetic" },
        { id: "deepseek", configured: false, model: "deepseek-synthetic" },
      ],
    });
    expect(received).toMatchObject({
      job: "explain-period-drivers",
      scope: { period: "week" },
    });
    expect(JSON.stringify(received)).not.toMatch(
      /private-account|private-instrument|PRIVATE-ISIN|private cost basis/,
    );
    await expect(response.json()).resolves.toEqual({
      result: expect.objectContaining({
        provider: "openai",
        model: "gpt-synthetic",
        generatedAt: "2026-09-08T10:05:00.000Z",
        job: "explain-period-drivers",
        factsAsOf: "2026-09-08T10:00:00.000Z",
        answer: expect.objectContaining({
          answer: expect.objectContaining({ evidence: ["period.total"] }),
        }),
        evidence: [expect.objectContaining({ key: "period.total" })],
      }),
    });
  });

  it("directly calls the data-quality tool and honors disabled holding names", async () => {
    let received: PortfolioAnalystContextV1 | undefined;
    const value = portfolio();
    value.holdings[0]!.freshness = "stale";
    value.insights.dataQuality.freshCount = 0;
    value.insights.dataQuality.staleCount = 1;
    const handlers = createPortfolioAnalystHandlers({
      providers: { openai: provider(async (context) => {
        received = context;
        return provider().generate(context);
      }) },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, { readCurrentPortfolio: () => value });

    const response = await handlers.POST(request({
      provider: "openai",
      job: "diagnose-data-quality",
      language: "zh-CN",
      includeHoldingNames: false,
    }));

    expect(response.status).toBe(200);
    expect(received?.job).toBe("diagnose-data-quality");
    expect(JSON.stringify(received)).not.toContain("Synthetic Fund");
  });

  it("rejects invalid input, missing facts and an unconfigured provider before generation", async () => {
    let calls = 0;
    const fake = provider(async (context) => {
      calls += 1;
      return provider().generate(context);
    });
    const configured = createPortfolioAnalystHandlers({
      providers: { openai: fake },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, { readCurrentPortfolio: () => undefined });

    expect((await configured.POST(request({
      provider: "openai",
      job: "explain-period-drivers",
      language: "en",
      includeHoldingNames: true,
    }))).status).toBe(400);
    expect((await configured.POST(request({
      provider: "openai",
      job: "diagnose-data-quality",
      language: "en",
      includeHoldingNames: true,
    }))).status).toBe(409);

    const unconfigured = createPortfolioAnalystHandlers({
      providers: {},
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, { readCurrentPortfolio: portfolio });
    expect((await unconfigured.POST(request({
      provider: "deepseek",
      job: "diagnose-data-quality",
      language: "en",
      includeHoldingNames: true,
    }))).status).toBe(503);
    expect(calls).toBe(0);
  });

  it("returns a safe code when provider output fails semantic validation", async () => {
    const handlers = createPortfolioAnalystHandlers({
      providers: { openai: provider(async () => {
        throw new PortfolioAnalystProviderError(
          "invalid-provider-output",
          "OpenAI",
        );
      }) },
      models: { openai: "gpt-synthetic", deepseek: "deepseek-synthetic" },
      defaultProvider: "openai",
    }, { readCurrentPortfolio: portfolio });

    const response = await handlers.POST(request({
      provider: "openai",
      job: "diagnose-data-quality",
      language: "en",
      includeHoldingNames: true,
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "OpenAI returned an invalid portfolio analyst answer.",
      code: "invalid-provider-output",
    });
  });
});
