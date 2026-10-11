import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createPortfolioAnalystTools } from "@/application/portfolio-analyst-tools";
import type { AnalystPortfolioReadModel } from "@/application/portfolio-analyst-contract";
import { createPiNativePortfolioAnalystRuntime } from "@/infrastructure/pi/pi-native-portfolio-analyst-runtime";
import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";
import { validMemoryContent } from "@/application/portfolio-analyst-memory";
import { defaultApiTestBudget, measureApiUsage } from "./api-usage";

const loadedOnly = process.env.PORTFOLIO_MEMORY_LOADED_ONLY === "1";
const enabled = process.env.RUN_PORTFOLIO_MEMORY_EVAL === "1";
describe.skipIf(!enabled)("real Agent memory normalization", () => {
  it("preserves personal background and conditional preferences, and requires an explicit request", async () => {
    if (existsSync(".env.local")) loadEnvFile(".env.local");
    const model = getPortfolioAnalystProviderRegistry().models.openai;
    const priorApiRequests = Number(process.env.PORTFOLIO_EVAL_PRIOR_API_REQUESTS ?? "0");
    const priorEstimatedUsd = Number(process.env.PORTFOLIO_EVAL_PRIOR_ESTIMATED_USD ?? "0");
    if (!Number.isInteger(priorApiRequests) || priorApiRequests < 0 || priorApiRequests >= 12 ||
      !Number.isFinite(priorEstimatedUsd) || priorEstimatedUsd < 0 || priorEstimatedUsd >= 0.10) throw new Error("Invalid prior budget usage.");
    const measurement = measureApiUsage(globalThis.fetch, { maxRequests: defaultApiTestBudget.maxRequests - priorApiRequests,
      maxEstimatedUsd: defaultApiTestBudget.maxEstimatedUsd - priorEstimatedUsd });
    const runtime = createPiNativePortfolioAnalystRuntime({ model, apiKey: process.env.OPENAI_API_KEY!, fetch: measurement.fetch });
    const database = createPortfolioDatabase(":memory:");
    const tools = createPortfolioAnalystTools({ insights: { asOf: "2026-10-11T12:00:00.000Z" }, holdings: [] } as unknown as AnalystPortfolioReadModel,
      database.readSourceAccounts());
    const outcomes: Array<{ question: string; reply: string; memory?: string; tools: string[] }> = [];
    let passed = false;
    try {
      const run = async (question: string, memories: import("@/application/portfolio-analyst-memory").PortfolioAnalystMemory[] = []) => {
        const result = await runtime.runTurn({ question, history: [], tools, language: "zh-CN", includeHoldingNames: true,
          defaultPeriod: "week", factsAsOf: "2026-10-11T12:00:00.000Z", memories });
        const content = result.kind === "conversation" ? result.memoryProposal?.content : undefined;
        outcomes.push({ question, reply: result.kind === "report" ? result.answer.answer.text : result.reply,
          memory: content, tools: result.audit.toolCalls.map((call) => call.name) });
        expect(database.listPortfolioAnalystMemories()).toEqual([]);
        expect(database.readPortfolioFacts().events).toEqual([]);
        return { result, content };
      };
      if (!loadedOnly) {
        const background = await run("添加记忆：我目前暂时住在赫尔辛基（Helsinki）。");
        expect(background.content).toBeDefined();
        expect(validMemoryContent(background.content!)).toBe(true);
        expect(background.content).toMatch(/Helsinki|赫尔辛基/i);
        expect(background.content).toMatch(/目前|当前|暂|current|temporar/i);
        expect(background.content).not.toMatch(/国籍|税务居民|nationality|tax.residen/i);
        expect(background.result.audit.toolCalls.some((call) => call.name === "read_memories")).toBe(true);
        const preference = await run("添加记忆：只有解释技术问题时，请用中文，代码标识符保留英文；其他话题的语言按我当时的要求来。");
        expect(preference.content).toBeDefined();
        expect(validMemoryContent(preference.content!)).toBe(true);
        expect(preference.content).toMatch(/技术|technical/i);
        expect(preference.content).toMatch(/中文|Chinese/i);
        expect(preference.content).toMatch(/标识符|代码|identifier|code/i);
        expect(preference.content).toMatch(/英文|English/i);
        expect(preference.content).toMatch(/其他|其余|非技术|当时|当前|请求|要求|other|request/i);
        const incidental = await run("我目前住在赫尔辛基，只是随口告诉你，不需要添加记忆。回应一句就好。");
        expect(incidental.content).toBeUndefined();
        expect(incidental.result.audit.toolCalls.some((call) => call.name === "propose_memory")).toBe(false);
      }
      const loaded = await run("What city did I tell you I currently live in? Reply in English in one short sentence; do not infer citizenship or tax residency.",
        [{ id: "synthetic-background", content: "The user currently lives temporarily in Helsinki.", source: "chat", createdAt: "2026-10-11", updatedAt: "2026-10-11" },
          { id: "synthetic-preference", content: "Explain technical topics in Chinese but preserve English code identifiers; use the requested language for other topics.", source: "chat", createdAt: "2026-10-11", updatedAt: "2026-10-11" }]);
      expect(loaded.content).toBeUndefined();
      expect(outcomes.at(-1)?.reply).toMatch(/Helsinki/);
      expect(outcomes.at(-1)?.reply).toMatch(/you|your|currently|live/i);
      expect(outcomes.at(-1)?.reply).not.toMatch(/[\u4e00-\u9fff]/u);
      passed = true;
    } finally {
      const report = { status: passed ? "passed" : "failed", scenarioCount: loadedOnly ? 1 : 4, priorApiRequests, priorEstimatedUsd, userTurns: outcomes.length,
        recordedAt: new Date().toISOString(), model, ...(await measurement.report()), outcomes };
      const directory = join(process.cwd(), "data/evaluations");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "memory-latest.json"), JSON.stringify(report, null, 2));
      writeFileSync(join(directory, `memory-${randomUUID()}.json`), JSON.stringify(report, null, 2));
      console.info(`Memory API evaluation: ${report.userTurns} turns, ${report.apiRequests} requests, estimated USD ${report.estimatedUsd ?? "unavailable"}`);
      database.close();
    }
  }, 180_000);
});
