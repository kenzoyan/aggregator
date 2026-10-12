import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPortfolioAnalystHandlers } from "@/app/api/portfolio/analyst/handler";
import { createAgentPriceSourceDiscovery } from "@/application/agent-price-source-discovery";
import { createPriceSourceService } from "@/application/price-source-service";
import { createPortfolioOverviewReadModel } from "@/application/portfolio-overview";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import { createSourceAccountDefinition } from "@/domain/source-accounts";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createProductionPriceSourceProviders } from "@/server/price-source-service";
import { OpenAIPriceSourceResearch } from "@/infrastructure/openai/openai-price-source-research";
import { createPiNativePortfolioAnalystRuntime } from "@/infrastructure/pi/pi-native-portfolio-analyst-runtime";
import { defaultApiTestBudget, measureApiUsage } from "./api-usage";

// Opt-in only. One shared gate covers every main-model and research request.
describe.skipIf(process.env.RUN_PRICE_SOURCE_EVAL !== "1")("Real fund source Agent", () => {
  it("delegates OP, Danske and Nordea research and persists honest review states without activating sources", async () => {
    process.loadEnvFile(".env.local");
    const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
    const model = process.env.OPENAI_ANALYST_MODEL?.trim() || process.env.OPENAI_NARRATIVE_MODEL?.trim() || "gpt-6-luna";
    expect(apiKey).not.toBe("");
    expect(model.startsWith("gpt-6-luna"), "Configured model must have reviewed pricing").toBe(true);
    const priorRequests = Number(process.env.PRICE_SOURCE_EVAL_PRIOR_API_REQUESTS ?? 0);
    const priorEstimatedUsd = Number(process.env.PRICE_SOURCE_EVAL_PRIOR_ESTIMATED_USD ?? 0);
    expect(Number.isFinite(priorRequests) && priorRequests >= 0 && Number.isInteger(priorRequests)).toBe(true);
    expect(Number.isFinite(priorEstimatedUsd) && priorEstimatedUsd >= 0).toBe(true);
    const measured = measureApiUsage(globalThis.fetch, { maxRequests: Math.max(0, defaultApiTestBudget.maxRequests - priorRequests), maxEstimatedUsd: Math.max(0, defaultApiTestBudget.maxEstimatedUsd - priorEstimatedUsd) });
    const results: Array<Record<string, unknown>> = [];
    const bank = process.env.PRICE_SOURCE_EVAL_BANK;
    expect(!bank || ["OP", "Danske", "Nordea"].includes(bank), "Choose a known public sample bank").toBe(true);
    try {
      for (const sample of [
        { bank: "OP", isin: "FI4000439773", name: "OP-Europe Fund A", expected: "verified" },
        { bank: "Danske", isin: "FI0008802988", name: "Danske Invest Eurooppa Osake K", expected: "verified" },
        { bank: "Nordea", isin: "FI4000010558", name: "Nordea Eurooppa Indeksi Select B", expected: "verified" },
      ].filter((sample) => !bank || sample.bank === bank)) {
        const db = createPortfolioDatabase(":memory:");
        try {
          const account = createSourceAccountDefinition({ id: `synthetic-${sample.bank}`, accountType: sample.bank });
          // Synthetic quantities and costs. Pure snapshots, never confirmed imports.
          const snapshots = [{ id: "synthetic", sourceAccountId: account.id, asOf: "2026-10-06", positions: [{ instrumentId: "fund", instrumentCode: sample.isin, displayName: process.env.PRICE_SOURCE_EVAL_SYNTHETIC_LABEL === "1" ? "Synthetic Danske European Equity" : sample.name, assetType: "fund" as const, currency: "EUR", quantity: "2", costBasis: "20", reportedPriorReturn: "0", observedPrice: "10", priceAsOf: "2026-10-06" }] }];
          const facts = { state: buildPortfolioState({ openingSnapshots: snapshots, events: [] }), openingSnapshots: snapshots, events: [], confirmedImports: [], confirmedSnapshots: [] };
          const database = { ...db, readPortfolioFacts: () => facts, readSourceAccounts: () => [account] };
          const service = createPriceSourceService({ database, fundNavProvider: { id: "eastmoney", fetchSince: async () => [] }, priceSourceProviders: createProductionPriceSourceProviders() });
          const discover = createAgentPriceSourceDiscovery({ database, service, research: new OpenAIPriceSourceResearch({ apiKey, model, fetch: measured.fetch }) });
          const runtime = createPiNativePortfolioAnalystRuntime({ apiKey, model, fetch: measured.fetch });
          const portfolio = createPortfolioOverviewReadModel({ snapshots, events: [], marketPrices: [], fxObservations: [], accountLabels: { [account.id]: sample.bank }, asOf: "2026-10-12" });
          const handlers = createPortfolioAnalystHandlers({ defaultProvider: "openai", models: { openai: model }, agentRuntimes: { openai: runtime } }, { conversations: db, readCurrentPortfolio: () => portfolio, readSourceAccounts: () => [account], readActivityFacts: () => facts, discoverPriceSource: discover });
          const response = await handlers.POST(new Request("http://localhost/api/portfolio/analyst", { method: "POST", body: JSON.stringify({ provider: "openai", mode: "agent", defaultPeriod: "week", language: "zh-CN", includeHoldingNames: true, question: `帮我查找 ${sample.bank} 账户里 ${sample.isin} 这只基金的每日净值来源，试读可支持的来源，然后生成价格来源确认草稿。先不要保存。` }) }));
          const body = await response.json();
          const turn = db.readLatestPortfolioAnalystConversation()?.turns.at(-1);
          results.push({ ...sample, httpStatus: response.status, replyCompleted: !turn?.chat?.failureCode, review: turn?.priceSourceReview, response: body });
          expect(response.status).toBe(200);
          expect(turn?.priceSourceReview?.state).toBe(sample.expected);
          expect(turn?.priceSourceReview?.status).toBe("pending");
          if (sample.bank === "Nordea") expect(turn?.priceSourceReview?.coverage).toBe("latest-only");
          if (process.env.PRICE_SOURCE_EVAL_SYNTHETIC_LABEL === "1" && sample.expected === "verified") {
            expect(turn?.chat?.assistantText).not.toMatch(/不一致|不匹配|不符|【call|【discover_price_source/);
            expect(turn?.chat?.assistantText).toContain(turn!.priceSourceReview!.candidates[0]!.price!);
            expect(turn?.chat?.assistantText).toContain(turn!.priceSourceReview!.candidates[0]!.priceAsOf!);
          }
          expect(db.readPriceSourceBindings()).toEqual([]);
          expect(db.readMarketData().observations).toEqual([]);
        } finally { db.close(); }
      }
    } finally {
      mkdirSync("data/evaluations", { recursive: true });
      const usage = await measured.report();
      writeFileSync(bank ? `data/evaluations/price-source-agent-${bank.toLowerCase()}.json` : "data/evaluations/price-source-agent.json", JSON.stringify({ at: new Date().toISOString(), scenarioCount: results.length, userTurns: results.length, priorRequests, priorEstimatedUsd, results, usage }, null, 2));
      console.log(JSON.stringify({ scenarios: results.map(({ bank, httpStatus, review }) => ({ bank, httpStatus, review })), usage }));
    }
  }, 240_000);
});
