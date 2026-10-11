import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPortfolioOverviewReadModel } from "@/application/portfolio-overview";
import { createPortfolioAnalystTools } from "@/application/portfolio-analyst-tools";
import { createPiNativePortfolioAnalystRuntime } from "@/infrastructure/pi/pi-native-portfolio-analyst-runtime";
import { OpenAIWebResearch } from "@/infrastructure/openai/openai-web-research";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";
import { defaultApiTestBudget, measureApiUsage } from "./api-usage";

const enabled = process.env.RUN_PORTFOLIO_CONTRIBUTION_EVAL === "1";
describe.skipIf(!enabled)("real period contribution and market explanations", () => {
  it("separates complete local arithmetic, dated market research and unavailable causes", async () => {
    if (existsSync(".env.local")) loadEnvFile(".env.local");
    const model = getPortfolioAnalystProviderRegistry().models.openai;
    const only = process.env.PORTFOLIO_CONTRIBUTION_EVAL_ONLY;
    const replayResearch = process.env.PORTFOLIO_CONTRIBUTION_REPLAY === "1";
    if (only && !["local", "research", "unavailable", "adapter-replay"].includes(only)) throw new Error("Unknown evaluation scenario");
    const priorApiRequests = Number(process.env.PORTFOLIO_EVAL_PRIOR_API_REQUESTS ?? "0");
    const priorEstimatedUsd = Number(process.env.PORTFOLIO_EVAL_PRIOR_ESTIMATED_USD ?? "0");
    if (!Number.isInteger(priorApiRequests) || priorApiRequests < 0 || priorApiRequests >= 12 ||
      !Number.isFinite(priorEstimatedUsd) || priorEstimatedUsd < 0 || priorEstimatedUsd >= .10) throw new Error("Invalid prior budget usage");
    const measurement = measureApiUsage(globalThis.fetch, { maxRequests: defaultApiTestBudget.maxRequests - priorApiRequests,
      maxEstimatedUsd: defaultApiTestBudget.maxEstimatedUsd - priorEstimatedUsd });
    const researchOutputs: unknown[] = [];
    const measuredResearchFetch: typeof fetch = async (url, options) => {
      const response = await measurement.fetch(url, options);
      // Public search output only, never request headers, keys or owner records.
      const payload = await response.clone().json() as { output?: unknown[] };
      researchOutputs.push(payload.output);
      return response;
    };
    const apiKey = process.env.OPENAI_API_KEY!;
    const database = createPortfolioDatabase(":memory:");
    const asOf = "2024-09-23T20:00:00.000Z";
    const portfolio = createPortfolioOverviewReadModel({
      snapshots: ["2024-09-16", "2024-09-23"].map((date, dateIndex) => ({
        id: `synthetic-${date}`, sourceAccountId: "synthetic", asOf: `${date}T12:00:00.000Z`,
        positions: [110,90,105,95,102,98].map((endPrice, index) => ({
          instrumentId: `synthetic-${index}`, displayName: index === 0 ? "Synthetic Nasdaq-100 tracker" : `Synthetic holding ${index}`,
          quantity: "1", currency: "EUR", costBasis: "100", observedPrice: String(dateIndex ? endPrice : 100),
        })),
      })), events: [], marketPrices: [], fxObservations: [], accountLabels: { synthetic: "Disposable demo" }, asOf,
    });
    const tools = createPortfolioAnalystTools(portfolio, []);
    const replayFetch: typeof fetch = async () => {
      const outputs = JSON.parse(readFileSync("data/evaluations/contribution-research-public-output.json", "utf8"));
      return Response.json({ status: "completed", output: outputs[0] });
    };
    const webResearch = new OpenAIWebResearch({ model, apiKey, fetch: replayResearch ? replayFetch : measuredResearchFetch });
    const runtime = createPiNativePortfolioAnalystRuntime({ model, apiKey, fetch: measurement.fetch, webResearch });
    const unavailableRuntime = createPiNativePortfolioAnalystRuntime({ model, apiKey, fetch: measurement.fetch,
      webResearch: { search: async () => ({ status: "unavailable", retrievedAt: asOf, findings: [] }) } });
    const outcomes: Array<{ scenario: string; question: string; answer: string; tools: unknown; evidence?: unknown }> = [];
    let attemptedTurns = 0, passed = false;
    const run = async (scenario: string, question: string, target = runtime) => {
      attemptedTurns += 1;
      const result = await target.runTurn({ question, history: [], tools, language: "en", includeHoldingNames: true, defaultPeriod: "week", factsAsOf: asOf });
      outcomes.push({ scenario, question, answer: result.kind === "report" ? result.answer.answer.text : result.reply,
        tools: result.audit.toolCalls, evidence: result.kind === "report" ? result.context.facts : undefined });
      expect(database.readPortfolioFacts().events).toEqual([]);
      expect(database.readPortfolioFacts().state.positions).toEqual([]);
      return result;
    };
    try {
      if (only === "adapter-replay") {
        expect(replayResearch).toBe(true);
        const result = await webResearch.search({ query: "Nasdaq-100 historical drivers", language: "en", dateRange: { from: "2024-09-16", to: "2024-09-23" } });
        expect(result.status).toBe("completed");
        expect(result.findings.length).toBeGreaterThan(0);
        expect(result.findings.every((finding) => finding.eventAsOf && finding.eventAsOf >= "2024-09-16" && finding.eventAsOf <= "2024-09-23")).toBe(true);
        outcomes.push({ scenario: "adapter-replay", question: "Recorded public source validation", answer: JSON.stringify(result), tools: [] });
      }
      if (!only || only === "local") {
      const arithmetic = await run("local-contributions", "Explain the last 7 days of my saved portfolio: which holdings rose or fell and what did they contribute? Use local data only; do not research news. Explain the calculation method and whether the leading contributors cover every holding.");
      expect(arithmetic.kind).toBe("report");
      if (arithmetic.kind !== "report") throw new Error("Expected local evidence report");
      expect(arithmetic.context.facts.find((fact) => fact.kind === "period-performance")).toMatchObject({
        method: "current-quantity", changeEur: 0, includedHoldingCount: 6, totalHoldingCount: 6, contributionResidualEur: 0,
      });
      expect(arithmetic.audit.toolCalls.some((call) => call.name === "read_period_drivers")).toBe(true);
      expect(arithmetic.audit.toolCalls.some((call) => call.name === "search_web")).toBe(false);
      expect(arithmetic.answer.answer.text).toMatch(/current.*quantit|quantit.*current/i);
      }

      if (!only || only === "research") {
      const research = await run("historical-market-drivers", `${replayResearch ? "In your first response request both the period read and web research before writing an answer. " : ""}First read my saved 7-day performance, then research possible Nasdaq-100 market drivers for 2024-09-16 through 2024-09-23 inclusive. Keep publication dates distinct from event dates. Distinguish source reports from hypotheses about the synthetic tracker. Do not claim proved causation or substitute current news.`);
      expect(research.kind).toBe("report");
      const searchCall = research.audit.toolCalls.find((call) => call.name === "search_web");
      expect(searchCall).toMatchObject({ input: { fromDate: "2024-09-16", toDate: "2024-09-23" } });
      expect(research.audit.toolCalls.some((call) => call.name === "read_period_drivers")).toBe(true);
      if (research.kind === "report") {
        const sources = research.context.facts.filter((fact) => fact.kind === "web-research-source");
        expect(sources.length).toBeGreaterThan(0);
        for (const source of sources) {
          expect(source.url).toMatch(/^https:\/\//);
          expect(source).toHaveProperty("publishedAt");
          expect(source).toHaveProperty("eventAsOf");
          const date = source.eventAsOf ?? source.publishedAt;
          if (date) { expect(date >= "2024-09-16" && date <= "2024-09-23").toBe(true); }
        }
        expect(research.answer.answer.text).toMatch(/possib|plausib|cannot|not.*prov|hypothe|may|could/i);
      }
      }

      if (!only || only === "unavailable") {
      const missing = await run("research-unavailable", "Research only Nasdaq-100 market reasons for 2024-09-16 through 2024-09-23. If the search cannot return evidence, say the market cause cannot be verified. Do not guess a news event or claim any portfolio amounts.", unavailableRuntime);
      expect(missing.audit.toolCalls.some((call) => call.name === "search_web")).toBe(true);
      expect(outcomes.at(-1)?.answer).toMatch(/unavail|cannot|unable|could not|not.*determin|no.*verif/i);
      }
      passed = true;
    } finally {
      const report = { status: passed ? "passed" : "failed", scenarioCount: only ? 1 : 3, replayResearch, priorApiRequests, priorEstimatedUsd, attemptedTurns, userTurns: only === "adapter-replay" ? 0 : outcomes.length,
        recordedAt: new Date().toISOString(), model, ...(await measurement.report()), outcomes };
      const directory = join(process.cwd(), "data/evaluations");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "contribution-latest.json"), JSON.stringify(report, null, 2));
      writeFileSync(join(directory, `contribution-${randomUUID()}.json`), JSON.stringify(report, null, 2));
      if (researchOutputs.length) writeFileSync(join(directory, "contribution-research-public-output.json"), JSON.stringify(researchOutputs, null, 2));
      console.info(`Contribution evaluation: ${report.userTurns}/${attemptedTurns} turns, ${report.apiRequests} API requests, estimated USD ${report.estimatedUsd ?? "unavailable"}`);
      database.close();
    }
  }, 240_000);
});
