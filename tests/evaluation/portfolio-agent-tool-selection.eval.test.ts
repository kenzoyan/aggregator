import { describe, expect, it } from "vitest";

import type { PortfolioAnalystContextV1, PortfolioAnalystTools } from "@/application/portfolio-analyst-contract";
import { createPiNativePortfolioAnalystRuntime } from "@/infrastructure/pi/pi-native-portfolio-analyst-runtime";

const runCloudEvaluation = process.env.RUN_PORTFOLIO_AGENT_EVAL === "1";

const periodContext: PortfolioAnalystContextV1 = {
  version: "portfolio-analyst-context.v1",
  job: "explain-period-drivers",
  language: "zh-CN",
  factsAsOf: "2026-09-09T10:00:00.000Z",
  scope: { period: "week" },
  definitions: {
    baseCurrency: "EUR",
    holdingCurrencyMeaning: "instrument-quoted-currency",
    portfolioActivityMeaning: "estimated-unexplained-value-movement",
  },
  facts: [{
    key: "period.total",
    kind: "period-performance",
    label: "Period performance",
    period: "week",
    coverage: "full",
    changeEur: 10,
    percent: 1,
    priceEffectEur: 8,
    fxEffectEur: 2,
    provenance: "portfolio-performance",
  }],
  limitations: [],
  allowedActions: [],
};

describe.skipIf(!runCloudEvaluation)("Portfolio Agent real-provider tool selection", () => {
  it("selects period drivers for a synthetic weekly-performance question", async () => {
    const { loadEnvConfig } = await import("@next/env");
    loadEnvConfig(process.cwd(), true);
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    expect(apiKey, "Set OPENAI_API_KEY in .env.local").not.toBe("");
    const tools: PortfolioAnalystTools = {
      readPeriodDrivers: (input) => ({
        ...periodContext,
        scope: { period: input.period },
        facts: periodContext.facts.map((fact) => fact.kind === "period-performance"
          ? { ...fact, period: input.period }
          : fact),
      }),
      readDataQuality: () => ({
        ...periodContext,
        job: "diagnose-data-quality",
        scope: {},
        facts: [{
          key: "quality.summary",
          kind: "quality-summary",
          label: "Data quality summary",
          valuedHoldingCount: 1,
          freshCount: 1,
          manualCount: 0,
          staleCount: 0,
          awaitingNavCount: 0,
          missingInputCount: 0,
          availablePerformancePeriods: ["week"],
          provenance: "portfolio-read-model",
        }],
      }),
      readPortfolioOverview: () => ({
        ...periodContext,
        job: "summarize-portfolio",
        scope: {},
        facts: [],
      }),
      readAccounts: () => { throw new Error("wrong tool"); },
      proposeCreateAccount: () => { throw new Error("wrong tool"); },
      prepareAccountImport: () => { throw new Error("wrong tool"); },
    };
    const runtime = createPiNativePortfolioAnalystRuntime({
      provider: "openai",
      model: process.env.OPENAI_ANALYST_MODEL ??
        process.env.OPENAI_NARRATIVE_MODEL ??
        "gpt-5.6-terra",
      apiKey,
    });

    const result = await runtime.runTurn({
      question: "这个合成投资组合本周为什么上涨？",
      history: [],
      tools,
      language: "zh-CN",
      includeHoldingNames: false,
      defaultPeriod: "week",
    });

    expect(result.context.job).toBe("explain-period-drivers");
    expect(result.context.scope.period).toBe("week");
    expect(result.audit.toolCalls).toMatchObject([
      { name: "read_period_drivers", input: { period: "week" }, status: "completed" },
    ]);
    expect(result.answer.answer.evidence).toContain("call1.period.total");
  }, 120_000);
});
