import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createPortfolioAnalystConversation, createPortfolioAnalystHistory } from "@/application/portfolio-analyst-conversation";
import { completePortfolioWorkflowReply } from "@/application/portfolio-workflow-reply";
import { createPortfolioAnalystTools } from "@/application/portfolio-analyst-tools";
import { createPortfolioOverviewReadModel } from "@/application/portfolio-overview";
import { createPiNativePortfolioAnalystRuntime } from "@/infrastructure/pi/pi-native-portfolio-analyst-runtime";
import { measureApiUsage } from "./api-usage";

describe.skipIf(process.env.RUN_PRICE_SOURCE_REPLY_EVAL !== "1")("Price-source confirmation main-Agent reply", () => {
  it("reads the saved structured result and explains it in Chinese without claiming prices were refreshed", async () => {
    process.loadEnvFile(".env.local");
    const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
    const model = process.env.OPENAI_ANALYST_MODEL?.trim() || process.env.OPENAI_NARRATIVE_MODEL?.trim() || "gpt-6-luna";
    expect(apiKey).not.toBe(""); expect(model.startsWith("gpt-6-luna")).toBe(true);
    const measured = measureApiUsage();
    const db = createPortfolioDatabase(":memory:");
    let result: unknown;
    try {
      const now = "2026-10-12T19:00:00Z";
      const conversation = createPortfolioAnalystConversation({ id: "synthetic-reply", now, provider: "openai", language: "en", includeHoldingNames: true });
      conversation.turns.push({ id: "request", question: "帮我查找 Danske 基金的每日净值来源，生成确认草稿。", createdAt: now, chat: { assistantText: "已找到来源，请在右侧确认。" } });
      conversation.turns.push({ id: "result", question: "", createdAt: now, chat: { assistantText: "", requestStatus: "pending", workflowResult: {
        workflow: "price-source", operation: "save", status: "succeeded", recordedAt: now, portfolioChanged: false,
        priceSource: { sourceAccountId: "synthetic", instrumentId: "fund", instrumentCode: "FI0008802988", instrumentName: "Synthetic Danske Fund", provider: "danske-invest", currency: "EUR", shareClass: "K (Accumulation)", identityUrl: "https://www.danskeinvest.fi/w/show_funds.product?p_nFund=2443&p_nFundgroup=59&p_nId=1432", confirmedAt: now, pricesUpdated: false, nextCheck: "manual-or-dashboard-daily" },
      } } });
      db.savePortfolioAnalystConversation(conversation);
      const runtime = createPiNativePortfolioAnalystRuntime({ apiKey, model, fetch: measured.fetch });
      const tools = createPortfolioAnalystTools(createPortfolioOverviewReadModel({ snapshots: [], events: [], marketPrices: [], fxObservations: [], accountLabels: {}, asOf: now }));
      result = await completePortfolioWorkflowReply({ conversations: db, conversation, turnId: "result", signal: new AbortController().signal,
        generate: async (chat, workflowResult, signal) => {
          const reply = await runtime.runTurn({ question: chat.turns[0].question, history: createPortfolioAnalystHistory(chat), tools, language: chat.language, includeHoldingNames: true, defaultPeriod: "week", workflowResult, signal });
          if (reply.kind !== "conversation") throw new Error("Expected conversation");
          expect(reply.audit.toolCalls.some((call) => call.name === "read_workflow_result" && call.status === "completed")).toBe(true);
          return { text: reply.reply, audit: reply.audit };
        } });
      const reply = db.readPortfolioAnalystConversation(conversation.id)!.turns.at(-1)!.chat!;
      expect(reply.requestStatus).toBeUndefined();
      expect(reply.assistantText).toMatch(/[\u4e00-\u9fff]/);
      expect(reply.assistantText).toMatch(/保存|确认|绑定/);
      expect(reply.assistantText).not.toContain("Price source confirmed. Future NAV checks will reuse it.");
      expect(db.readPriceSourceBindings()).toEqual([]); expect(db.readMarketData().observations).toEqual([]);
    } finally {
      const usage = await measured.report();
      mkdirSync("data/evaluations", { recursive: true });
      writeFileSync("data/evaluations/price-source-reply.json", JSON.stringify({ scenarioCount: 1, userTurns: 1, result, usage }, null, 2));
      console.log(JSON.stringify(usage)); db.close();
    }
  }, 120000);
});
