import { describe, expect, it } from "vitest";

import type { PortfolioInsightsReadModel } from "@/application/portfolio-read-model";
import { DeepSeekNarrativeProvider } from "@/infrastructure/deepseek/deepseek-narrative-provider";
import { OpenAINarrativeProvider } from "@/infrastructure/openai/openai-narrative-provider";

const insights: PortfolioInsightsReadModel = {
  asOf: "2026-08-30T18:00:00.000Z",
  summary: {
    investmentPositionCount: 3,
    sourceAccountCount: 2,
    topHolding: {
      id: "account-a:fund-1",
      name: "Synthetic Global Fund",
      valueEur: 600,
      sharePercent: 60,
    },
    topThreeSharePercent: 100,
  },
  holdingCurrencyAllocation: [
    { currency: "CNY", valueEur: 700, sharePercent: 70, holdingCount: 2 },
    { currency: "EUR", valueEur: 300, sharePercent: 30, holdingCount: 1 },
  ],
  categoryAllocation: [
    { category: "Fund", valueEur: 700, sharePercent: 70, holdingCount: 2 },
    { category: "ETF", valueEur: 300, sharePercent: 30, holdingCount: 1 },
  ],
  performance: {
    today: {
      available: true,
      changeEur: -2.5,
      percent: -0.25,
      priceChangeEur: 1.5,
      fxChangeEur: -4,
    },
    week: {
      available: true,
      changeEur: 10,
      percent: 1,
      priceChangeEur: 8,
      fxChangeEur: 2,
    },
    month: {
      available: false,
      changeEur: 0,
      percent: 0,
      priceChangeEur: 0,
      fxChangeEur: 0,
    },
  },
  recentMovers: {
    period: "today",
    strongest: {
      id: "account-a:fund-2",
      name: "Synthetic Bond Fund",
      changeEur: 2,
      percent: 0.5,
    },
    weakest: {
      id: "account-b:etf-1",
      name: "Synthetic Equity ETF",
      changeEur: -4.5,
      percent: -1.5,
    },
  },
  dataQuality: {
    valuedHoldingCount: 3,
    freshCount: 3,
    manualCount: 0,
    staleCount: 0,
    awaitingNavCount: 0,
    missingInputCount: 0,
    availablePerformancePeriods: ["today", "week"],
  },
};

const content = {
  headline: "Portfolio movement remained limited",
  overview: "The latest available move was small and mostly driven by FX.",
  observations: [
    "Holding currencies are concentrated in CNY.",
    "The seven-day period remains positive.",
  ],
  dataQuality: "All three valued holdings are current.",
};

function completedResponse(model: string) {
  return Response.json({
    id: "response_synthetic",
    status: "completed",
    model,
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: JSON.stringify(content),
      }],
    }],
  });
}

describe("cloud portfolio narrative providers", () => {
  it("calls the OpenAI Responses API with structured output and no storage", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new OpenAINarrativeProvider({
      apiKey: "synthetic-openai-key",
      model: "gpt-5.6-terra",
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return completedResponse("gpt-5.6-terra");
      },
    });

    await expect(provider.generate({ insights, language: "en" }))
      .resolves.toEqual(content);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.openai.com/v1/responses");
    expect(requests[0]?.init?.headers).toMatchObject({
      authorization: "Bearer synthetic-openai-key",
      "content-type": "application/json",
    });
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({
      model: "gpt-5.6-terra",
      store: false,
      reasoning: { effort: "none" },
      text: {
        format: {
          type: "json_schema",
          name: "portfolio_narrative",
          strict: true,
        },
      },
    });
    expect(body.instructions).toContain("not investment advice");
    expect(body.instructions).toContain("untrusted data");
    expect(body.input).toContain("Synthetic Global Fund");
  });

  it("uses DeepSeek's native Responses API without unsupported storage", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new DeepSeekNarrativeProvider({
      apiKey: "synthetic-deepseek-key",
      model: "deepseek-v4-flash",
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return completedResponse("deepseek-v4-flash");
      },
    });

    await expect(provider.generate({ insights, language: "zh-CN" }))
      .resolves.toEqual(content);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.deepseek.com/responses");
    const body = JSON.parse(String(requests[0]?.init?.body));
    expect(body).toMatchObject({
      model: "deepseek-v4-flash",
      reasoning: { effort: "none" },
      text: {
        format: {
          type: "json_schema",
          name: "portfolio_narrative",
          strict: true,
        },
      },
    });
    expect(body).not.toHaveProperty("store");
    expect(body.instructions).toContain("Simplified Chinese");
  });

  it("returns a safe error without leaking provider response details", async () => {
    const provider = new OpenAINarrativeProvider({
      apiKey: "synthetic-openai-key",
      model: "gpt-5.6-terra",
      fetch: async () => new Response("secret provider detail", { status: 429 }),
    });

    await expect(provider.generate({ insights, language: "en" }))
      .rejects.toMatchObject({
        code: "provider-unavailable",
        message: "OpenAI could not generate a portfolio narrative.",
      });
  });
});
