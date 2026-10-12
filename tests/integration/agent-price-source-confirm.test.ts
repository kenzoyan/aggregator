import { createWorkflowReplyHandler } from "@/app/api/portfolio/analyst/sale/reply/handler";
import { createPendingActionCancelHandler } from "@/app/api/portfolio/analyst/pending-actions/handler";
import { describe, expect, it, vi } from "vitest";
import { createAgentPriceSourceConfirmHandler } from "@/app/api/portfolio/analyst/price-source/handler";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createPortfolioAnalystConversation, createPortfolioAnalystHistory } from "@/application/portfolio-analyst-conversation";
import { createAgentPriceSourceDiscovery } from "@/application/agent-price-source-discovery";
import { createPriceSourceService } from "@/application/price-source-service";
import { createSourceAccountDefinition } from "@/domain/source-accounts";
const position = { sourceAccountId: "synthetic-op", instrumentId: "fund", displayName: "Synthetic OP", instrumentCode: "FI4000439773", assetType: "fund" as const, currency: "EUR", quantity: "2", costBasis: "400", reportedPriorReturn: "0" };
const now = () => "2026-10-12T12:00:00Z";
const request = (candidateId = "ft-FI4000439773-EUR") => new Request("http://localhost/api/portfolio/analyst/price-source", { method: "POST", body: JSON.stringify({ conversationId: "chat", turnId: "turn", candidateId }) });
async function setup() {
  const db = createPortfolioDatabase(":memory:");
  let holding = position;
  const database = { ...db, readSourceAccounts: () => [createSourceAccountDefinition({ id: position.sourceAccountId, accountType: "OP" })], readPortfolioFacts: () => ({ state: { positions: [holding], cashBalances: [], appliedEventIds: [] } }) };
  const fetchSince = vi.fn(async (code: string) => [{ instrumentCode: code, price: "224.79", asOf: "2026-10-09", currency: "EUR", source: "financial-times" }]);
  const service = createPriceSourceService({ database, now, fundNavProvider: { id: "eastmoney", fetchSince: async () => [] }, priceSourceProviders: { "financial-times": { id: "financial-times", fetchSince } } });
  const review = await createAgentPriceSourceDiscovery({ database, service, now, research: { search: async () => ({ findings: [], status: "completed", retrievedAt: now() }) } })({ sourceAccountId: position.sourceAccountId, instrumentId: position.instrumentId, language: "en" });
  const conversation = createPortfolioAnalystConversation({ id: "chat", now: now(), provider: "openai", language: "en", includeHoldingNames: true });
  conversation.turns.push({ id: "turn", createdAt: now(), question: "Find source", chat: { assistantText: "Review required" }, priceSourceReview: review });
  db.savePortfolioAnalystConversation(conversation);
  return { db, database, service, fetchSince, change: () => { holding = { ...position, instrumentCode: "FI0000000000" }; } };
}
describe("Agent source confirmation", () => {
  it("confirms only a persisted candidate, records no price, and survives reload with idempotent retry", async () => {
    const { db, database, service } = await setup();
    try {
      const handler = createAgentPriceSourceConfirmHandler({ database, service, now });
      expect((await handler(request("invented"))).status).toBe(409);
      expect(db.readPriceSourceBindings()).toEqual([]);
      expect((await handler(request())).status).toBe(200);
      expect(db.readPriceSourceBindings()).toMatchObject([{ provider: "financial-times" }]);
      expect(db.readMarketData().observations).toEqual([]);
      expect(db.readPortfolioAnalystConversation("chat")!.turns[0].priceSourceReview?.status).toBe("saved");
      expect((await handler(request())).status).toBe(200);
      expect(createPortfolioAnalystHistory(db.readPortfolioAnalystConversation("chat")!).some((message) => message.text.includes("Price source review status: saved"))).toBe(true);
    } finally { db.close(); }
  });
  it("rejects changed holding identity and cancelled review", async () => {
    const { db, database, service, change } = await setup();
    try {
      change();
      expect((await createAgentPriceSourceConfirmHandler({ database, service, now })(request())).status).toBe(409);
      expect(db.readPriceSourceBindings()).toEqual([]);
      const chat = db.readPortfolioAnalystConversation("chat")!;
      chat.turns[0].priceSourceReview!.status = "cancelled"; db.savePortfolioAnalystConversation(chat);
      expect((await createAgentPriceSourceConfirmHandler({ database, service, now })(request())).status).toBe(409);
    } finally { db.close(); }
  });
  it("rejects cancellation while the confirmation probe is awaiting", async () => {
    const { db, database, service, fetchSince } = await setup();
    try {
      fetchSince.mockImplementation(async (code) => {
        const chat = db.readPortfolioAnalystConversation("chat")!;
        chat.turns[0].priceSourceReview!.status = "cancelled"; db.savePortfolioAnalystConversation(chat);
        return [{ instrumentCode: code, price: "224.79", asOf: "2026-10-09", currency: "EUR", source: "financial-times" }];
      });
      expect((await createAgentPriceSourceConfirmHandler({ database, service, now })(request())).status).toBe(409);
      expect(db.readPriceSourceBindings()).toEqual([]);
    } finally { db.close(); }
  });
  it("keeps review pending on a failed re-probe", async () => {
    const { db, database, service, fetchSince } = await setup();
    try {
      fetchSince.mockRejectedValue(new Error("provider timed out"));
      expect((await createAgentPriceSourceConfirmHandler({ database, service, now })(request())).status).toBe(503);
      expect(db.readPriceSourceBindings()).toEqual([]);
      expect(db.readPortfolioAnalystConversation("chat")!.turns[0].priceSourceReview?.status).toBe("pending");
    } finally { db.close(); }
  });
  it("cancels a persisted review through the pending-action endpoint and blocks activation", async () => {
    const { db, database, service } = await setup();
    try {
      const cancel = createPendingActionCancelHandler(db, now);
      const cancelRequest = () => new Request("http://localhost/cancel", { method: "POST", body: JSON.stringify({ conversationId: "chat", kind: "price-source", id: "turn" }) });
      expect((await cancel(cancelRequest())).status).toBe(200);
      expect((await cancel(cancelRequest())).status).toBe(200);
      expect((await createAgentPriceSourceConfirmHandler({ database, service, now })(request())).status).toBe(409);
      expect(db.readPriceSourceBindings()).toEqual([]);
      expect(db.readMarketData().observations).toEqual([]);
    } finally { db.close(); }
  });

});

it("feeds a structured saved-source result to the main Agent and persists its reply without replacing the research answer", async () => {
  const { db, database, service } = await setup();
  try {
    const respond = vi.fn(async (_conversation, result) => {
      expect(result).toMatchObject({ workflow: "price-source", operation: "save", status: "succeeded", portfolioChanged: false,
        priceSource: { provider: "financial-times", instrumentCode: "FI4000439773", currency: "EUR", pricesUpdated: false } });
      expect(db.readPriceSourceBindings()).toHaveLength(1);
      return { text: "这个价格源已保存，下次检查净值会使用它。", audit: { runtime: "pi-agent-core" as const, modelTurns: 2, stopReason: "completed" as const, toolCalls: [] } };
    });
    const handler = createAgentPriceSourceConfirmHandler({ database, service, now, respond, createId: () => "source-result" });
    expect((await handler(request())).status).toBe(200);
    const chat = db.readPortfolioAnalystConversation("chat")!;
    expect(chat.turns[0].chat?.assistantText).toBe("Review required");
    expect(chat.turns.at(-1)?.chat?.assistantText).toContain("这个价格源已保存");
    expect((await handler(request())).status).toBe(200);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(db.readPortfolioAnalystConversation("chat")!.turns).toHaveLength(2);
    expect(db.readMarketData().observations).toEqual([]);
  } finally { db.close(); }
});

it("keeps the confirmed binding and a retryable structured outcome if the confirmation reply fails", async () => {
  const { db, database, service } = await setup();
  try {
    const response = await createAgentPriceSourceConfirmHandler({ database, service, now, createId: () => "source-result", respond: async () => { throw new Error("Model unavailable"); } })(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replyUnavailable: true, replyTurnId: "source-result" });
    expect(db.readPriceSourceBindings()).toHaveLength(1);
    expect(db.readPortfolioAnalystConversation("chat")!.turns.at(-1)?.chat).toMatchObject({ assistantText: "", requestStatus: "pending", workflowResult: { workflow: "price-source", status: "succeeded" } });
    const retry = createWorkflowReplyHandler({ conversations: db, generate: async (_chat, result) => {
      expect(result.priceSource?.pricesUpdated).toBe(false);
      return { text: "价格源已保存。", audit: { runtime: "pi-agent-core", modelTurns: 2, stopReason: "completed", toolCalls: [] } };
    } });
    expect((await retry(new Request("http://localhost/reply", { method: "POST", body: JSON.stringify({ conversationId: "chat", turnId: "source-result" }) }))).status).toBe(200);
    expect(db.readPortfolioAnalystConversation("chat")!.turns.at(-1)?.chat?.assistantText).toBe("价格源已保存。");
    expect(db.readPriceSourceBindings()).toHaveLength(1);
    expect(db.readMarketData().observations).toEqual([]);
  } finally { db.close(); }
});
