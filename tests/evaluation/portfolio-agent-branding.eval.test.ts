import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { describe, expect, it } from "vitest";

import type { PortfolioAnalystTools } from "@/application/portfolio-analyst-contract";
import type { PortfolioAnalystHistoryMessage } from "@/application/portfolio-analyst-conversation";
import { createPiNativePortfolioAnalystRuntime } from "@/infrastructure/pi/pi-native-portfolio-analyst-runtime";
import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";
import { defaultApiTestBudget, measureApiUsage } from "./api-usage";

describe.skipIf(process.env.RUN_PORTFOLIO_BRANDING_EVAL !== "1")("Gator real-model identity", () => {
  it("keeps its name and product identity across English and Chinese turns without reading portfolio data", async () => {
    const localEnv = join(process.cwd(), ".env.local");
    if (existsSync(localEnv)) loadEnvFile(localEnv);
    const registry = getPortfolioAnalystProviderRegistry();
    expect(registry.agentRuntimes.openai, "Configure OPENAI_API_KEY in .env.local").toBeDefined();
    const priorApiRequests = Number(process.env.PORTFOLIO_EVAL_PRIOR_API_REQUESTS ?? "0");
    if (!Number.isInteger(priorApiRequests) || priorApiRequests < 0 || priorApiRequests >= defaultApiTestBudget.maxRequests) {
      throw new Error("Invalid prior API request count; owner approval required.");
    }
    const measurement = measureApiUsage(globalThis.fetch, {
      ...defaultApiTestBudget, maxRequests: defaultApiTestBudget.maxRequests - priorApiRequests,
    });
    const runtime = createPiNativePortfolioAnalystRuntime({
      model: registry.models.openai, apiKey: process.env.OPENAI_API_KEY!, fetch: measurement.fetch,
    });
    const history: PortfolioAnalystHistoryMessage[] = [];
    // Identity questions must never read or change the owner's data.
    const tools = new Proxy({} as PortfolioAnalystTools, {
      get: () => () => { throw new Error("Identity questions must not access portfolio tools."); },
    });
    const turns: Array<{ question: string; reply: string }> = [];
    let userTurns = 0;
    let passed = false;
    try {
      for (const question of [
        "What is your name, and which application are you the assistant for?",
        "请用中文再介绍一下你的名字，以及你属于哪个应用。",
      ]) {
        userTurns += 1;
        const result = await runtime.runTurn({ question, history, tools, language: "en",
          includeHoldingNames: false, defaultPeriod: "week", factsAsOf: "2026-10-15T00:00:00Z" });
        expect(result.kind).toBe("conversation");
        const reply = result.kind === "conversation" ? result.reply : result.answer.answer.text;
        turns.push({ question, reply });
        expect(reply).toContain("Gator");
        expect(reply).toContain("Aggregator");
        expect(result.audit.toolCalls).toEqual([]);
        history.push({ role: "user", text: question }, {
          role: "assistant", text: reply, factsAsOf: "2026-10-15T00:00:00Z",
        });
      }
      expect(turns[1].reply).toMatch(/[\u4e00-\u9fff]/);
      passed = true;
    } finally {
      const report = { recordedAt: new Date().toISOString(), passed, scenarioCount: 1,
        userTurns, priorApiRequests, ...(await measurement.report()), turns };
      const directory = join(process.cwd(), "data", "evaluations");
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "branding-latest.json"), JSON.stringify(report, null, 2));
      console.info(JSON.stringify(report));
    }
  }, 120_000);
});
