import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createPortfolioAnalystTools } from "@/application/portfolio-analyst-tools";
import type { AnalystPortfolioReadModel } from "@/application/portfolio-analyst-contract";
import { appendPortfolioAnalystTurn, type PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystAgentResult } from "@/application/portfolio-analyst-agent";
import { portfolioAnalystHistory } from "@/server/portfolio-analyst-history";
import { createPortfolioDraftTools } from "@/server/portfolio-draft-tools";
import { measureApiUsage } from "./api-usage";
import { createPiNativePortfolioAnalystRuntime } from "@/infrastructure/pi/pi-native-portfolio-analyst-runtime";
import { OpenAIWebResearch } from "@/infrastructure/openai/openai-web-research";
import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";

const enabled = process.env.RUN_PORTFOLIO_MULTIMODAL_EVAL === "1";

// Real configured model and web API, production transcript builder and draft tools.
// Only synthetic images/accounts; isolated disposable DB; never calls confirmation.
describe.skipIf(!enabled)("Portfolio Agent real multimodal conversation", () => {
  it("answers image plus research, recalls the image, and imports it after account clarification", async () => {
    const localEnv = join(process.cwd(), ".env.local");
    if (existsSync(localEnv)) loadEnvFile(localEnv);
    const registry = getPortfolioAnalystProviderRegistry();
    expect(registry.agentRuntimes.openai, "Configure OPENAI_API_KEY in .env.local").toBeDefined();
    const measurement = measureApiUsage();
    const model = registry.models.openai;
    const apiKey = process.env.OPENAI_API_KEY!;
    const runtime = createPiNativePortfolioAnalystRuntime({ model, apiKey, fetch: measurement.fetch,
      webResearch: new OpenAIWebResearch({ model, apiKey, fetch: measurement.fetch }) });
    let passed = false;
    const turns: Array<{ question: string; reply: string; tools: unknown }> = [];
    console.info(`Live evaluation model: ${registry.models.openai}`);
    const directory = mkdtempSync(join(tmpdir(), "portfolio-multimodal-eval-"));
    const database = createPortfolioDatabase(join(directory, "test.sqlite"));
    try {
      const firstAccount = database.createSourceAccount({ id: randomUUID(), accountType: "微信", label: "Test 1" });
      database.createSourceAccount({ id: randomUUID(), accountType: "WeChat Wealth", label: "WeChat" });
      const image = await readFile(new URL("../fixtures/vision-import/synthetic-alipay.png", import.meta.url));
      const imageId = randomUUID();
      const sourceTurnId = randomUUID();
      const now = "2026-10-10T12:00:00.000Z";
      let conversation: PortfolioAnalystConversation = {
        version: "portfolio-analyst-conversation.v1", id: randomUUID(), provider: "openai", language: "zh-CN",
        includeHoldingNames: true, createdAt: now, updatedAt: now, importActivities: [], turns: [{
          id: sourceTurnId, question: "", createdAt: now, chat: { assistantText: "", requestStatus: "pending" },
          attachments: [{ id: imageId, mimeType: "image/png", byteLength: image.length }],
        }],
      };
      database.savePortfolioAnalystConversation(conversation);
      const tools = createPortfolioAnalystTools({ insights: { asOf: now }, holdings: [] } as unknown as AnalystPortfolioReadModel,
        database.readSourceAccounts());
      const text = (result: PortfolioAnalystAgentResult) => result.kind === "report" ? result.answer.answer.text : result.reply;
      const run = async (question: string) => {
        const turnId = randomUUID();
        const history = await portfolioAnalystHistory(conversation, { read: async () => image });
        conversation = appendPortfolioAnalystTurn(conversation, { id: turnId, question, userText: question, createdAt: now, chat: { assistantText: "", requestStatus: "pending" } });
        database.savePortfolioAnalystConversation(conversation);
        const result = await runtime!.runTurn({ question, history, tools,
          language: "zh-CN", includeHoldingNames: true, defaultPeriod: "week", factsAsOf: now,
          memories: [{ id: "address", content: "Always address me as Master.", source: "settings", createdAt: now, updatedAt: now }],
          draftTools: createPortfolioDraftTools(database, conversation.id, turnId),
        });
        // Show only synthetic outputs and tool names, never credentials or transport headers.
        const outcome = { question, reply: text(result), tools: result.audit.toolCalls.map((call) => ({ name: call.name, status: call.status })) };
        turns.push(outcome);
        console.info(JSON.stringify(outcome));
        const stored = database.readPortfolioAnalystConversation(conversation.id)!;
        conversation = { ...stored, turns: stored.turns.map((turn) => turn.id === turnId
          ? { id: turn.id, question: turn.question, userText: turn.userText, createdAt: turn.createdAt, chat: { assistantText: text(result) } } : turn) };
        database.savePortfolioAnalystConversation(conversation);
        expect(text(result)).toContain("Master");
        expect(database.readPortfolioFacts().events).toEqual([]);
        return result;
      };
      const mixed = await run("查一下 Nasdaq-100 最近收盘表现，顺便解释最近上传的图片，告诉我图中的总资产金额。");
      expect(mixed.audit.toolCalls.some((call) => call.name === "search_web" && call.status === "completed")).toBe(true);
      expect(text(mixed)).toMatch(/Nasdaq|纳斯达克/i);
      expect(text(mixed).replaceAll(",", "")).toContain("12345.67");
      const explanation = await run("只解释最近上传的图片，告诉我图中的两项基金和总金额。");
      expect(text(explanation).replaceAll(",", "")).toContain("12345.67");
      expect(explanation.audit.toolCalls.some((call) => call.name === "search_web")).toBe(false);
      await run("以最近的这张图片为依据，帮我导入到微信账户吧。");
      // Ambiguous account names must not create an import until the choice is explicit.
      expect(database.readPortfolioAnalystConversation(conversation.id)?.importActivities).toHaveLength(0);
      const imported = await run("test1");
      expect(imported.audit.toolCalls.some((call) => call.name === "prepare_import_draft")).toBe(true);
      const activities = database.readPortfolioAnalystConversation(conversation.id)!.importActivities;
      expect(activities).toHaveLength(1);
      const draft = database.getImportDraft(activities[0]!.draftId)!;
      expect(draft.status).toBe("draft");
      expect(draft.sourceAccountId).toBe(firstAccount.id);
      expect(draft.portfolio.holdings).toHaveLength(2);
      expect(database.readPortfolioFacts().state.positions).toEqual([]);
      await run("将导入草稿中“示例全球科技指数基金”的持有份额改成 6000，保留其他字段。");
      const { createImportDraftReadModel } = await import("@/application/imports/import-draft-read-model");
      expect(createImportDraftReadModel(database.getImportDraft(draft.id)!).portfolio.holdings.find((holding) => holding.displayName === "示例全球科技指数基金")?.quantity).toBe("6000");
      expect(database.getImportDraft(draft.id)!.status).toBe("draft");
      passed = true;
    } finally {
      const report = { status: passed ? "passed" : "failed", recordedAt: new Date().toISOString(), scenarioCount: 1, userTurns: turns.length,
        pricingSource: "https://developers.openai.com/api/docs/models/gpt-6-luna", pricingChecked: "2026-10-10",
        ...(await measurement.report()), turns };
      const reportDirectory = join(process.cwd(), "data", "evaluations");
      mkdirSync(reportDirectory, { recursive: true });
      writeFileSync(join(reportDirectory, "multimodal-latest.json"), JSON.stringify(report, null, 2));
      writeFileSync(join(reportDirectory, `multimodal-${report.recordedAt.replaceAll(":", "-")}.json`), JSON.stringify(report, null, 2));
      console.info(`API test report: ${report.userTurns} user turns, ${report.apiRequests} API requests, estimated USD ${report.estimatedUsd ?? "unavailable"}`);
      database.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }, 300_000);
});
