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
    if (only && !["local", "research", "unavailable", "adapter-replay", "reliability"].includes(only)) throw new Error("Unknown evaluation scenario");
    const priorApiRequests = Number(process.env.PORTFOLIO_EVAL_PRIOR_API_REQUESTS ?? "0");
    const priorEstimatedUsd = Number(process.env.PORTFOLIO_EVAL_PRIOR_ESTIMATED_USD ?? "0");
    // Set only after explicit owner approval; prior usage remains in the report.
    const extension = process.env.PORTFOLIO_EVAL_APPROVED_EXTENSION === "6-requests-0.05-usd";
    const extensionUsedRequests = Number(process.env.PORTFOLIO_EVAL_EXTENSION_USED_REQUESTS ?? "0");
    const extensionUsedUsd = Number(process.env.PORTFOLIO_EVAL_EXTENSION_USED_USD ?? "0");
    if (!Number.isInteger(extensionUsedRequests) || extensionUsedRequests < 0 || extensionUsedRequests > 6 ||
      !Number.isFinite(extensionUsedUsd) || extensionUsedUsd < 0 || extensionUsedUsd > .05 ||
      (!extension && (extensionUsedRequests || extensionUsedUsd))) throw new Error("Invalid extension usage");
    if (!Number.isInteger(priorApiRequests) || priorApiRequests < 0 || (!extension && priorApiRequests >= 12) ||
      !Number.isFinite(priorEstimatedUsd) || priorEstimatedUsd < 0 || (!extension && priorEstimatedUsd >= .10)) throw new Error("Invalid prior budget usage");
    const measurement = measureApiUsage(globalThis.fetch, extension ? { maxRequests: 6 - extensionUsedRequests, maxEstimatedUsd: .05 - extensionUsedUsd } : {
      maxRequests: defaultApiTestBudget.maxRequests - priorApiRequests,
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
      const verifiedReplayFile = process.env.PORTFOLIO_CONTRIBUTION_VERIFIED_REPLAY_FILE;
      if (verifiedReplayFile) {
        // Replay previously validated public findings, not a new live search or the raw provider envelope.
        const report = JSON.parse(readFileSync(verifiedReplayFile, "utf8"));
        const result = JSON.parse(report.outcomes.find((outcome: { scenario: string }) => outcome.scenario === "adapter-replay").answer);
        return Response.json({ status: "completed", output: [
          { type: "web_search_call", action: { sources: result.findings.map((finding: { url: string; title: string }) => ({ url: finding.url, title: finding.title })) } },
          { type: "message", content: [{ type: "output_text", text: JSON.stringify({ findings: result.findings }) }] },
        ] });
      }
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
      if (only === "reliability") {
        const company = await run("live-company-research", "Search the web and explain what the Finnish company Granlund does. Cite usable sources. This is a general company profile, not a request for a dated news event.");
        expect(company.kind).toBe("report");
        expect(company.audit.toolCalls.find((call) => call.name === "search_web")?.input.fromDate).toBeUndefined();
        expect(company.audit.toolCalls.find((call) => call.name === "search_web")?.input.toDate).toBeUndefined();
        if (company.kind === "report") expect(company.context.facts.some((fact) => fact.kind === "web-research-source")).toBe(true);
      }
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

      if (!only || only === "research" || only === "reliability") {
      const historicalRuntime = only === "reliability" ? createPiNativePortfolioAnalystRuntime({ model, apiKey, fetch: measurement.fetch,
        webResearch: new OpenAIWebResearch({ model, apiKey, fetch: replayFetch }) }) : runtime;
      const research = await run("historical-market-drivers", "First read my saved 7-day performance, then research possible Nasdaq-100 market drivers for 2024-09-16 through 2024-09-23 inclusive. Keep publication dates distinct from event dates. Distinguish source reports from hypotheses about the synthetic tracker. Do not claim proved causation or substitute current news.", historicalRuntime);
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
      const usage = await measurement.report();
      const report = { status: passed ? "passed" : "failed", scenarioCount: only === "reliability" ? 2 : only ? 1 : 3, replayResearch,
        historicalResearchReplayed: only === "reliability" || replayResearch,
        verifiedFindingsReplayed: Boolean(process.env.PORTFOLIO_CONTRIBUTION_VERIFIED_REPLAY_FILE),
        approvedExtension: extension, priorApiRequests, priorEstimatedUsd,
        extensionUsedRequests, extensionUsedUsd,
        cumulativeApiRequests: priorApiRequests + extensionUsedRequests + usage.apiRequests,
        cumulativeEstimatedUsd: usage.estimatedUsd === null ? null : priorEstimatedUsd + extensionUsedUsd + usage.estimatedUsd,
        attemptedTurns, userTurns: only === "adapter-replay" ? 0 : outcomes.length,
        recordedAt: new Date().toISOString(), model, ...usage, outcomes };
      const directory = join(process.cwd(), "data/evaluations");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "contribution-latest.json"), JSON.stringify(report, null, 2));
      writeFileSync(join(directory, `contribution-${randomUUID()}.json`), JSON.stringify(report, null, 2));
      if (researchOutputs.length) writeFileSync(join(directory, `contribution-research-${only === "reliability" ? "company-" : ""}public-output.json`), JSON.stringify(researchOutputs, null, 2));
      console.info(`Contribution evaluation: ${report.userTurns}/${attemptedTurns} turns, ${report.apiRequests} API requests, estimated USD ${report.estimatedUsd ?? "unavailable"}`);
      database.close();
    }
  }, 240_000);
});
