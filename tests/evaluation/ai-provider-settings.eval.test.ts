import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAIProviderSettingsStore, getAIEnvironment } from "@/server/ai-provider-settings";
import { createAIProviderSettingsHandlers } from "@/app/api/settings/ai-provider/handler";
import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";
import { createPiNativePortfolioAnalystRuntime } from "@/infrastructure/pi/pi-native-portfolio-analyst-runtime";
import { createOpenAIImageQuestion } from "@/infrastructure/openai/openai-image-question";
import { createPortfolioOverviewReadModel } from "@/application/portfolio-overview";
import { createPortfolioAnalystTools } from "@/application/portfolio-analyst-tools";
import { defaultApiTestBudget, measureApiUsage } from "./api-usage";

describe.skipIf(process.env.RUN_AI_SETTINGS_EVAL !== "1")("real OpenAI requests with Settings credentials", () => {
  it("uses saved configuration for Agent text and synthetic image analysis without environment fallback", async () => {
    if (existsSync(".env.local")) loadEnvFile(".env.local");
    const key = getAIEnvironment().OPENAI_API_KEY;
    expect(Boolean(key), "An existing OpenAI key is required for the live evaluation.").toBe(true);
    const directory = mkdtempSync(join(tmpdir(), "aggrigator-ai-settings-eval-"));
    const priorRequests = Number(process.env.AI_SETTINGS_EVAL_PRIOR_REQUESTS ?? "0");
    if (!Number.isInteger(priorRequests) || priorRequests < 0 || priorRequests >= defaultApiTestBudget.maxRequests) throw new Error("Invalid prior request count.");
    const measurement = measureApiUsage(globalThis.fetch, { ...defaultApiTestBudget, maxRequests: defaultApiTestBudget.maxRequests - priorRequests });
    let completedScenarios = 0;
    try {
      const store = createAIProviderSettingsStore(join(directory, "settings.json"));
      const handlers = createAIProviderSettingsHandlers(store, {});
      expect((await handlers.PATCH(new Request("http://localhost:3000/api/settings/ai-provider", {
        method: "PATCH", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-6-luna", apiKey: key }),
      }))).status).toBe(200);
      const configuration = getAIEnvironment({}, store.read());
      const model = getPortfolioAnalystProviderRegistry(configuration).models.openai;
      const portfolio = createPortfolioOverviewReadModel({ snapshots: [], events: [], marketPrices: [], fxObservations: [], accountLabels: {}, asOf: "2026-10-13T12:00:00Z" });
      const runtime = createPiNativePortfolioAnalystRuntime({ model, apiKey: configuration.OPENAI_API_KEY!, fetch: measurement.fetch });
      const result = await runtime.runTurn({ question: "Reply with only READY. Do not read portfolio data or use tools.",
        history: [], tools: createPortfolioAnalystTools(portfolio, []), language: "en", includeHoldingNames: true, defaultPeriod: "week" });
      expect(result.kind).toBe("conversation");
      if (result.kind === "conversation") expect(result.reply).toMatch(/READY/i);
      completedScenarios += 1;
      const answer = await createOpenAIImageQuestion({ model: configuration.OPENAI_IMAGE_QUESTION_MODEL!, apiKey: configuration.OPENAI_API_KEY!, fetch: measurement.fetch })({
        question: "What is the displayed total value? Include its exact amount and currency.", language: "en",
        images: [{ bytes: readFileSync(join(process.cwd(), "tests/fixtures/vision-import/synthetic-alipay.png")), mimeType: "image/png" }],
      });
      expect(answer.answer).toMatch(/12,?345\.67/);
      expect(answer.answer).toMatch(/CNY|RMB|yuan|¥/i);
      completedScenarios += 1;
    } finally {
      const usage = await measurement.report();
      const report = { scenarioCount: 2, userTurns: 2, completedScenarios, priorRequests, totalRequestAttempts: priorRequests + usage.apiRequests, usage };
      mkdirSync("data/evaluations", { recursive: true });
      writeFileSync("data/evaluations/ai-provider-settings.json", JSON.stringify(report, null, 2));
      console.info(JSON.stringify(report));
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);
});
