import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createAgentSaleHandlers } from "@/app/api/portfolio/analyst/sale/handler";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { initializePortfolioSchema } from "@/infrastructure/sqlite/portfolio-schema";
import type { PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import type { SaleScreenshot } from "@/application/agent-sale-draft";
const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach((fn) => fn()); });
const extraction: SaleScreenshot = { status: "completed", accountName: "Test", name: "Fund", symbol: "123",
  date: "2020-01-02", quantity: "2", gross: null, net: "29", fees: "1", currency: "EUR",
  destination: "external-account", destinationName: "Bank", warnings: [] };
const request = (method: string, value: object) => new Request("http://localhost/api/portfolio/analyst/sale", {
  method, headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: "chat", ...value }),
});
function setup(withReply = true) {
  const directory = mkdtempSync(join(tmpdir(), "sale-image-test-"));
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "portfolio.sqlite");
  const sql = new DatabaseSync(filename);
  initializePortfolioSchema(sql);
  sql.prepare("INSERT INTO import_drafts (id,source_account_id,source_kind,created_at,confidence,warnings_json,portfolio_json,status,confirmed_at) VALUES ('draft','a','manual','2020-01-01','high','[]','{}','confirmed','2020-01-01')").run();
  sql.prepare("INSERT INTO confirmed_imports (id,draft_id,source_account_id,source_kind,confirmed_at) VALUES ('import','draft','a','manual','2020-01-01')").run();
  const snapshot = { id: "initial", sourceAccountId: "a", asOf: "2020-01-01T00:00:00Z",
    positions: [{ instrumentId: "f", displayName: "Fund", instrumentCode: "123", quantity: "10", costBasis: "100", currency: "EUR" }],
    portfolioCash: { amount: "50", currency: "EUR" } };
  sql.prepare("INSERT INTO opening_snapshots (id,source_account_id,as_of,payload_json,confirmed_import_id) VALUES ('initial','a',?,?,'import')").run(snapshot.asOf, JSON.stringify(snapshot));
  sql.close();
  const database = createPortfolioDatabase(filename);
  cleanup.push(() => database.close());
  const conversation: PortfolioAnalystConversation = { version: "portfolio-analyst-conversation.v1", id: "chat", provider: "openai",
    language: "en", includeHoldingNames: true, createdAt: "2020-01-03", updatedAt: "2020-01-03", importActivities: [],
    turns: [{ id: "source", question: "Record this sale", userText: "Record this sale", createdAt: "2020-01-03", attachments: [
      { id: "11111111-1111-4111-8111-111111111111", mimeType: "image/png", byteLength: 3 } ],
      chat: { assistantText: "Prepare sale", imageAction: { sourceTurnId: "source", stage: "intent", purpose: "sale" } } }] };
  database.savePortfolioAnalystConversation(conversation);
  const extract = vi.fn(async (_request: import("@/infrastructure/openai/openai-sale-extractor").SaleExtractionRequest) => extraction);
  let id = 0;
  const respond = vi.fn<import("@/application/portfolio-workflow-reply").WorkflowReplyGenerator>(async (_conversation, result) => ({
    text: `Agent generated: ${result.operation} ${result.status}`,
    audit: { runtime: "pi-agent-core", modelTurns: 1, stopReason: "completed", toolCalls: [] },
  }));
  const handlers = createAgentSaleHandlers({
    ...(withReply ? { respond } : {}),
    conversations: database, images: { read: async () => new Uint8Array([1,2,3]), save: async () => {}, delete: async () => {} },
    readFacts: () => database.readPortfolioFacts(),
    readHoldings: () => [{ sourceAccountId: "a", instrumentId: "f", accountName: "Test", name: "Fund", symbol: "123", currency: "EUR", isFund: true, prices: [] }],
    confirmSale: (...args) => database.confirmSale(...args), extract, createId: () => `draft-turn-${++id}`, now: () => "2020-01-03T10:00:00Z",
  });
  return { database, filename, handlers, extract, respond };
}
async function draft(state: ReturnType<typeof setup>) {
  const result = await state.handlers.POST(request("POST", { sourceTurnId: "source" }));
  expect(result.status).toBe(200);
  return (await result.json()).conversation.turns.at(-1).id as string;
}
it("prepares without writes, reviews external net proceeds, confirms once, persists and supports undo", async () => {
  const state = setup();
  const turnId = await draft(state);
  expect(state.database.readPortfolioFacts().events).toEqual([]);
  const preview = await (await state.handlers.PUT(request("PUT", { turnId }))).json();
  expect(preview.preview).toMatchObject({ quantityAfter: "8", netProceeds: "29", saleResult: "9", cashAfter: "50", externalOutflow: "29" });
  expect((await state.handlers.PUT(request("PUT", { turnId, confirm: true }))).status).toBe(409);
  const saved = await state.handlers.PUT(request("PUT", { turnId, confirm: true, reviewToken: preview.reviewToken }));
  expect(saved.status).toBe(201);
  expect((await state.handlers.PUT(request("PUT", { turnId, confirm: true, reviewToken: preview.reviewToken }))).status).toBe(409);
  const reopened = createPortfolioDatabase(state.filename);
  expect(reopened.readPortfolioFacts().state.positions[0].quantity).toBe("8");
  expect(reopened.readPortfolioAnalystConversation("chat")?.turns.find((turn) => turn.id === turnId)?.chat?.saleDraft?.status).toBe("saved");
  const { createCashActivityReadModel } = await import("@/application/portfolio-cash-activity");
  const activity = createCashActivityReadModel(reopened.readPortfolioFacts(), "a");
  reopened.undoCashActivity(activity.records[0].id, activity.reviewToken);
  expect(reopened.readPortfolioFacts().state.positions[0].quantity).toBe("10");
  reopened.close();
});
it("does not duplicate extraction on retry and cancels without a sale", async () => {
  const state = setup();
  const turnId = await draft(state);
  await draft(state);
  expect(state.extract).toHaveBeenCalledTimes(1);
  expect((await state.handlers.PATCH(request("PATCH", { turnId, cancel: true }))).status).toBe(200);
  expect(state.database.readPortfolioFacts().events).toEqual([]);
});
it.each(["pending", "unknown", "multiple", "not-sale"] as const)("rejects %s screenshots", async (status) => {
  const state = setup(); state.extract.mockResolvedValue({ ...extraction, status });
  expect((await state.handlers.POST(request("POST", { sourceTurnId: "source" }))).status).toBe(409);
  expect(state.database.readPortfolioFacts().events).toEqual([]);
});
it("rejects inconsistent money and stale reviews after an edit", async () => {
  const state = setup();
  state.extract.mockResolvedValueOnce({ ...extraction, gross: "99" });
  expect((await state.handlers.POST(request("POST", { sourceTurnId: "source" }))).status).toBe(409);
  const turnId = await draft(state);
  const preview = await (await state.handlers.PUT(request("PUT", { turnId }))).json();
  const fields = state.database.readPortfolioAnalystConversation("chat")!.turns.at(-1)!.chat!.saleDraft!.fields;
  await state.handlers.PATCH(request("PATCH", { turnId, fields: { ...fields, amount: "35" } }));
  expect((await state.handlers.PUT(request("PUT", { turnId, confirm: true, reviewToken: preview.reviewToken }))).status).toBe(409);
  expect(state.database.readPortfolioFacts().events).toEqual([]);
});
it("persists natural-language corrections but still requires a fresh review", async () => {
  const state = setup(); const turnId = await draft(state);
  state.extract.mockResolvedValue({ ...extraction, fees: "0", destinationName: "Other Bank" });
  expect((await state.handlers.PATCH(request("PATCH", { turnId, text: "Fee was zero; withdrawn to Other Bank." }))).status).toBe(200);
  const current = state.database.readPortfolioAnalystConversation("chat")!;
  expect(current.turns.find((turn) => turn.id === turnId)?.chat?.saleDraft?.fields).toMatchObject({ fees: "0", destinationName: "Other Bank" });
  expect(current.turns.at(-1)?.userText).toContain("Other Bank");
  expect(state.database.readPortfolioFacts().events).toEqual([]);
});
it("rejects a re-upload of the same image after saving and permits it after undo", async () => {
  const state = setup(); const turnId = await draft(state);
  const preview = await (await state.handlers.PUT(request("PUT", { turnId }))).json();
  await state.handlers.PUT(request("PUT", { turnId, confirm: true, reviewToken: preview.reviewToken }));
  const conversation = state.database.readPortfolioAnalystConversation("chat")!;
  const anotherSource = { ...conversation.turns[0], id: "source-2" };
  state.database.savePortfolioAnalystConversation({ ...conversation, turns: [...conversation.turns, anotherSource] });
  expect((await state.handlers.POST(request("POST", { sourceTurnId: "source-2" }))).status).toBe(409);
  const { createCashActivityReadModel } = await import("@/application/portfolio-cash-activity");
  const activity = createCashActivityReadModel(state.database.readPortfolioFacts(), "a");
  state.database.undoCashActivity(activity.records[0].id, activity.reviewToken);
  expect((await state.handlers.POST(request("POST", { sourceTurnId: "source-2" }))).status).toBe(200);
});
it("requires acknowledgement for a similar existing transaction", async () => {
  const state = setup();
  const { prepareSaleReview } = await import("@/application/portfolio-sale");
  const sale = { sourceAccountId: "a", instrumentId: "f", date: "2020-01-02", quantity: "2", proceeds: "30", fees: "1", destination: { kind: "external-account" as const, name: "Bank" } };
  const previous = prepareSaleReview(state.database.readPortfolioFacts(), sale);
  state.database.confirmSale(sale, previous.reviewToken, "earlier-manual");
  const turnId = await draft(state);
  const preview = await (await state.handlers.PUT(request("PUT", { turnId }))).json();
  expect(preview.possibleDuplicate).toBe(true);
  expect((await state.handlers.PUT(request("PUT", { turnId, confirm: true, reviewToken: preview.reviewToken }))).status).toBe(409);
  expect((await state.handlers.PUT(request("PUT", { turnId, confirm: true, reviewToken: preview.reviewToken, duplicateAcknowledged: true }))).status).toBe(201);
  expect(state.database.readPortfolioFacts().events).toHaveLength(2);
});
it("accepts explicit natural-language cancellation without writing", async () => {
  const state = setup(); const turnId = await draft(state);
  state.extract.mockResolvedValue({ ...extraction, status: "cancelled" });
  expect((await state.handlers.PATCH(request("PATCH", { turnId, text: "Cancel this draft." }))).status).toBe(200);
  expect(state.database.readPortfolioAnalystConversation("chat")?.turns.find((turn) => turn.id === turnId)?.chat?.saleDraft?.status).toBe("cancelled");
  expect(state.database.readPortfolioFacts().events).toEqual([]);
});
it("does not overwrite a conversation changed while extraction is running", async () => {
  const state = setup();
  state.extract.mockImplementation(async () => {
    const conversation = state.database.readPortfolioAnalystConversation("chat")!;
    state.database.savePortfolioAnalystConversation({ ...conversation, updatedAt: "2020-01-04" });
    return extraction;
  });
  expect((await state.handlers.POST(request("POST", { sourceTurnId: "source" }))).status).toBe(409);
  const current = state.database.readPortfolioAnalystConversation("chat")!;
  expect(current.turns[0].id).toBe("source");
  expect(current.turns.at(-1)?.chat?.workflowResult?.status).toBe("failed");
  expect(current.turns.some((turn) => turn.chat?.saleDraft)).toBe(false);
});

it("supplies trusted success and duplicate failure results to the Agent instead of canned chat text", async () => {
  const state = setup(); const turnId = await draft(state);
  expect(state.respond.mock.calls[0][1]).toMatchObject({ operation: "prepare", status: "succeeded", portfolioChanged: false });
  const preview = await (await state.handlers.PUT(request("PUT", { turnId }))).json();
  const result = await (await state.handlers.PUT(request("PUT", { turnId, confirm: true, reviewToken: preview.reviewToken }))).json();
  expect(result.conversation.turns.at(-1).chat.assistantText).toBe("Agent generated: save succeeded");
  expect(state.respond.mock.calls.at(-1)![1]).toMatchObject({ operation: "save", status: "succeeded", portfolioChanged: true,
    sale: { netProceeds: "29", realizedResult: "9", excludedFromTrackedAssets: true } });
  const duplicate = await (await state.handlers.POST(request("POST", { sourceTurnId: "source" }))).json();
  expect(duplicate.conversation.turns.at(-1).chat.assistantText).toBe("Agent generated: prepare failed");
  expect(state.respond.mock.calls.at(-1)![1]).toMatchObject({ status: "failed", code: "duplicate-image", portfolioChanged: false });
  expect(state.database.readPortfolioFacts().events).toHaveLength(1);
});
it("keeps a saved sale when Agent generation fails and retries only its reply", async () => {
  const state = setup(); const turnId = await draft(state);
  const preview = await (await state.handlers.PUT(request("PUT", { turnId }))).json();
  state.respond.mockRejectedValueOnce(new Error("Synthetic provider failure"));
  const saved = await state.handlers.PUT(request("PUT", { turnId, confirm: true, reviewToken: preview.reviewToken }));
  expect(saved.status).toBe(201);
  const result = await saved.json();
  expect(result.replyUnavailable).toBe(true);
  expect(state.database.readPortfolioFacts().events).toHaveLength(1);
  const stored = state.database.readPortfolioAnalystConversation("chat")!;
  expect(stored.turns.at(-1)?.chat).toMatchObject({ assistantText: "", requestStatus: "pending",
    workflowResult: { operation: "save", status: "succeeded", portfolioChanged: true } });
  const { createWorkflowReplyHandler } = await import("@/app/api/portfolio/analyst/sale/reply/handler");
  const handler = createWorkflowReplyHandler({ conversations: state.database, generate: state.respond });
  const reply = await handler(request("POST", { turnId: result.replyTurnId }));
  expect((await reply.json()).conversation.turns.at(-1).chat.assistantText).toBe("Agent generated: save succeeded");
  expect(state.database.readPortfolioFacts().events).toHaveLength(1);
  const calls = state.respond.mock.calls.length;
  await handler(request("POST", { turnId: result.replyTurnId }));
  expect(state.respond).toHaveBeenCalledTimes(calls);
});
it("rejects a client-supplied workflow result instead of letting it forge a successful operation", async () => {
  const state = setup();
  const result = await state.handlers.POST(request("POST", { sourceTurnId: "source",
    workflowResult: { status: "succeeded", operation: "save", portfolioChanged: true } }));
  expect(result.status).toBe(400);
  expect(state.database.readPortfolioFacts().events).toEqual([]);
  expect(state.respond.mock.calls.at(-1)![1].status).toBe("failed");
});


it("lets agent draft tools prepare text sales, preview and cancel without changing the ledger", async () => {
  const state = setup(false);
  const { createPortfolioDraftTools } = await import("@/server/portfolio-draft-tools");
  const conversation = state.database.readPortfolioAnalystConversation("chat")!;
  state.database.savePortfolioAnalystConversation({ ...conversation, turns: [...conversation.turns, {
    id: "text-sale", question: "I sold 2 units of Fund for net 29 EUR, fee 1 EUR on 2020-01-02, withdrawn to Bank.",
    createdAt: "2020-01-03", chat: { assistantText: "", requestStatus: "pending" },
  }] });
  const tools = createPortfolioDraftTools(state.database, "chat", "text-sale", undefined, state.handlers);
  const prepared = await tools.execute("prepare_sale_draft");
  expect(prepared).toMatchObject({ status: "succeeded", portfolioChanged: false, draft: { amount: "29", destinationName: "Bank" } });
  expect(state.extract.mock.calls[0][0]).toMatchObject({ text: expect.stringContaining("net 29 EUR") });
  expect(state.extract.mock.calls[0][0]).not.toHaveProperty("image");
  expect((await tools.execute("prepare_sale_draft")).status).toBe("failed");
  expect(state.extract).toHaveBeenCalledTimes(1);
  expect(await tools.execute("review_sale_draft")).toMatchObject({ status: "succeeded", preview: { netProceeds: "29", realizedResult: "9" } });
  expect(state.database.readPortfolioFacts().events).toEqual([]);
  const cancel = createPortfolioDraftTools(state.database, "chat", "text-sale", undefined, state.handlers);
  expect(await cancel.execute("cancel_sale_draft")).toMatchObject({ status: "succeeded", operation: "cancel" });
  expect(state.database.readPortfolioFacts().events).toEqual([]);
  expect(state.database.readPortfolioFacts().state.positions[0].quantity).toBe("10");
});

it("passes the latest user message with its explicitly selected saved screenshot", async () => {
  const state = setup(false);
  const { createPortfolioDraftTools } = await import("@/server/portfolio-draft-tools");
  const conversation = state.database.readPortfolioAnalystConversation("chat")!;
  state.database.savePortfolioAnalystConversation({ ...conversation, turns: [...conversation.turns, {
    id: "latest", question: "The money was withdrawn to Bank", createdAt: "2020-01-03", chat: { assistantText: "" },
  }] });
  const tools = createPortfolioDraftTools(state.database, "chat", "latest", "source", state.handlers);
  expect((await tools.execute("prepare_sale_draft")).status).toBe("succeeded");
  expect(state.extract.mock.calls[0][0]).toMatchObject({ image: { mimeType: "image/png" }, text: expect.stringContaining("withdrawn to Bank") });
  const invalid = createPortfolioDraftTools(state.database, "chat", "latest", "unowned-source", state.handlers);
  // Existing draft can be inspected, but an unknown image cannot be used to prepare another sale.
  expect((await invalid.execute("prepare_sale_draft")).status).toBe("failed");
  expect(state.extract).toHaveBeenCalledTimes(1);
});

it("uses the main Agent's structured sale facts for a selected historical image without another model call", async () => {
  const state = setup(false);
  const { createPortfolioDraftTools } = await import("@/server/portfolio-draft-tools");
  const conversation = state.database.readPortfolioAnalystConversation("chat")!;
  const source = conversation.turns[0];
  const secondImage = { id: "22222222-2222-4222-8222-222222222222", mimeType: "image/png" as const, byteLength: 3 };
  state.database.savePortfolioAnalystConversation({ ...conversation, turns: [
    { ...source, attachments: [...source.attachments!, secondImage] },
    { id: "later", question: "Use the second image to record a sale", createdAt: "2020-01-04", chat: { assistantText: "" } },
  ] });
  const tools = createPortfolioDraftTools(state.database, "chat", "later", undefined, state.handlers);
  expect(await tools.execute("prepare_sale_draft", undefined, { sourceTurnId: "source", imageIds: [secondImage.id], sale: extraction }))
    .toMatchObject({ status: "succeeded", portfolioChanged: false, draft: { amount: "29", destination: "external-account", destinationName: "Bank" } });
  expect(state.extract).not.toHaveBeenCalled();
  expect(state.database.readPortfolioFacts().events).toEqual([]);
});

it("keeps a failed text sale out of the image workflow", async () => {
  const state = setup(false);
  const conversation = state.database.readPortfolioAnalystConversation("chat")!;
  state.database.savePortfolioAnalystConversation({ ...conversation, turns: [
    { id: "text", question: "Record a sale", createdAt: "2020-01-04", chat: { assistantText: "" } },
  ] });
  const response = await state.handlers.POST(request("POST", { sourceTurnId: "text", textOnly: true, extraction: { ...extraction, status: "unknown" } }));
  expect(response.status).toBe(409);
  const result = await response.json();
  expect(result.conversation.turns.at(-1).chat.workflowResult.status).toBe("failed");
  expect(result.conversation.turns.at(-1).chat.imageAction).toBeUndefined();
  expect(state.extract).not.toHaveBeenCalled();
});

it("creates a draft from selected conversation images, rejects foreign references and never confirms assets", async () => {
  const state = setup(false);
  const { createPortfolioDraftTools } = await import("@/server/portfolio-draft-tools");
  const account = state.database.createSourceAccount({ id: "synthetic-import", accountType: "Synthetic screenshot account" });
  const { screenshotExtractionSchema } = await import("@/application/imports/vision-extraction-contract");
  const holdings = screenshotExtractionSchema.parse({ accountName: "Synthetic screenshot account", asOf: "2020-01-03T00:00:00Z",
    asOfYearVisible: true, currency: "EUR", totalValue: "100", reportedPriorReturn: null, portfolioCash: null,
    confidence: "high", warnings: [], positions: [{ displayName: "Synthetic Fund", instrumentCode: "TEST", assetType: "fund",
      quantity: "10", currency: "EUR", marketValue: "100", costBasis: "90", reportedPriorReturn: null,
      reportedPriorReturnPercent: null, averageCost: null, observedPrice: "10", priceAsOf: "2020-01-03T00:00:00Z",
      priceAsOfYearVisible: true, confidence: "high" }] });
  const tools = createPortfolioDraftTools(state.database, "chat", "source", undefined, state.handlers);
  expect(await tools.execute("prepare_import_draft", undefined, { sourceTurnId: "foreign", imageIds: ["foreign"], accountId: account.id, holdings }))
    .toMatchObject({ status: "failed", code: "image-not-found" });
  const args = { sourceTurnId: "source", imageIds: ["11111111-1111-4111-8111-111111111111"], accountId: account.id, holdings };
  const result = await tools.execute("prepare_import_draft", undefined, args);
  expect(result).toMatchObject({ status: "succeeded", portfolioChanged: false, importDraft: { holdingCount: 1 } });
  const draftId = result.importDraft!.id;
  expect(state.database.getImportDraft(draftId)?.status).toBe("draft");
  expect(state.database.readPortfolioAnalystConversation("chat")?.importActivities).toMatchObject([{ draftId, sourceTurnId: "source" }]);
  expect(state.database.readPortfolioFacts().events).toEqual([]);
  expect(state.extract).not.toHaveBeenCalled();
  const retry = createPortfolioDraftTools(state.database, "chat", "source", undefined, state.handlers);
  expect((await retry.execute("prepare_import_draft", undefined, args)).importDraft?.id).toBe(draftId);
  const correction = createPortfolioDraftTools(state.database, "chat", "source", undefined, state.handlers);
  expect(await correction.execute("update_import_draft", undefined, { importEdit: { field: "valuation-date", value: "2020-01-04" } }))
    .toMatchObject({ status: "succeeded", portfolioChanged: false });
  expect(state.database.getImportDraft(draftId)?.portfolio.asOf).toMatchObject({ value: "2020-01-04T00:00:00.000Z" });
  const editedDraft = state.database.getImportDraft(draftId)!;
  const lineId = editedDraft.portfolio.holdings[0]!.lineId;
  const quantityEdit = createPortfolioDraftTools(state.database, "chat", "source", undefined, state.handlers);
  expect(await quantityEdit.execute("update_import_draft", undefined, { importEdit: { field: "quantity", value: "12", holdingLineId: lineId } }))
    .toMatchObject({ status: "succeeded", portfolioChanged: false, importDraft: { holdings: [{ quantity: "12" }] } });
  const foreignEdit = createPortfolioDraftTools(state.database, "chat", "source", undefined, state.handlers);
  expect(await foreignEdit.execute("update_import_draft", undefined, { importEdit: { field: "costBasis", value: "999", holdingLineId: "foreign" } }))
    .toMatchObject({ status: "failed", code: "holding-not-found" });
  expect(state.database.readPortfolioFacts().events).toEqual([]);
  expect(state.extract).not.toHaveBeenCalled();
  expect(state.database.readPortfolioFacts().events).toEqual([]);

});
