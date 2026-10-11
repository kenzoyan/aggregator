import { afterEach, describe, expect, it } from "vitest";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createPendingActionCancelHandler } from "@/app/api/portfolio/analyst/pending-actions/handler";
import { createPortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import { draftPortfolioFromOpeningSnapshot } from "@/domain/imports";
import { saleDraftFields, type SaleScreenshot } from "@/application/agent-sale-draft";
import { pendingAgentActions } from "@/components/agent-pending-actions";
import { createImportDraftReadModel } from "@/application/imports/import-draft-read-model";

const databases: ReturnType<typeof createPortfolioDatabase>[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));
const now = "2026-10-11T12:00:00.000Z";
function fixture() {
  const database = createPortfolioDatabase(":memory:"); databases.push(database);
  for (const id of ["import", "foreign"]) database.saveImportDraft({ id, sourceAccountId: "account", sourceKind: "screenshot",
    createdAt: now, confidence: "high", warnings: [], portfolio: draftPortfolioFromOpeningSnapshot({
      id: `snapshot-${id}`, sourceAccountId: "account", asOf: now,
      positions: [{ instrumentId: "fund", quantity: "2", costBasis: "20", currency: "EUR" }],
    }, "vision") });
  const extraction: SaleScreenshot = { status: "completed", accountName: "Test", name: "Fund", symbol: null,
    date: "2026-10-10", quantity: "1", gross: "10", net: "10", fees: "0", currency: "EUR",
    destination: "investment-account", destinationName: null, warnings: [] };
  const conversation = createPortfolioAnalystConversation({ id: "chat", provider: "openai", language: "en", includeHoldingNames: true, now });
  conversation.importActivities = [{ draftId: "import", targetLabel: "Test", submissionText: "Import", screenshotCount: 1, createdAt: now }];
  conversation.turns = [
    { id: "memory", question: "Remember", createdAt: now, chat: { assistantText: "Review", memoryProposal: { content: "Use EUR", status: "pending" } } },
    { id: "sale", question: "Sale", createdAt: now, chat: { assistantText: "Review", saleDraft: {
      sourceTurnId: "sale", imageDigest: "synthetic", status: "pending", extraction, fields: saleDraftFields(extraction),
    } } },
  ];
  database.savePortfolioAnalystConversation(conversation);
  const handler = createPendingActionCancelHandler(database, () => now);
  const cancel = (kind: string, id: string, extra = {}) => handler(new Request("http://localhost/api/portfolio/analyst/pending-actions", {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ conversationId: "chat", kind, id, ...extra }),
  }));
  return { database, cancel };
}

describe("cancel pending Agent items", () => {
  it.each(["import", "sale", "memory"])("cancels only the selected %s and keeps assets unchanged", async (kind) => {
    const { database, cancel } = fixture();
    const before = database.readPortfolioFacts();
    const response = await cancel(kind, kind);
    expect(response.status).toBe(200);
    const payload = await response.json();
    const drafts = Object.fromEntries(payload.importDrafts.map((draft: ReturnType<typeof createImportDraftReadModel>) => [draft.id, draft]));
    const actions = pendingAgentActions(database.readPortfolioAnalystConversation("chat"), drafts);
    expect(actions).toHaveLength(2);
    expect(actions.some((action) => action.kind === kind)).toBe(false);
    expect(database.readPortfolioFacts()).toEqual(before);
    expect(database.listPortfolioAnalystMemories()).toEqual([]);
    expect(database.getImportDraft("foreign")?.status).toBe("draft");
    expect(database.readPortfolioAnalystConversation("chat")?.turns.map((turn) => turn.chat?.assistantText)).toEqual(["Review", "Review"]);
    expect((await cancel(kind, kind)).status).toBe(200); // Retry after a lost response is harmless.
  });
  it("rejects foreign IDs, wrong kinds, malformed requests and old conversations", async () => {
    const { database, cancel } = fixture();
    const before = database.readPortfolioAnalystConversation("chat");
    expect((await cancel("import", "foreign")).status).toBe(404);
    expect((await cancel("memory", "sale")).status).toBe(404);
    expect((await cancel("unknown", "memory")).status).toBe(400);
    expect((await cancel("memory", "memory", { confirm: true })).status).toBe(400);
    expect(database.readPortfolioAnalystConversation("chat")).toEqual(before);
    database.savePortfolioAnalystConversation(createPortfolioAnalystConversation({ id: "new", provider: "openai", language: "en", includeHoldingNames: true, now: "2026-10-11T13:00:00.000Z" }));
    expect((await cancel("memory", "memory")).status).toBe(404);
  });
  it("rejects confirmed imports before calling discard and rejects oversized input", async () => {
    const { database } = fixture();
    const draft = database.getImportDraft("import")!;
    const handler = createPendingActionCancelHandler({ ...database, getImportDraft: (id) =>
      id === "import" ? { ...draft, status: "confirmed" } : database.getImportDraft(id) });
    const request = (body: string) => new Request("http://localhost/api/portfolio/analyst/pending-actions", { method: "PATCH", body });
    expect((await handler(request(JSON.stringify({ conversationId: "chat", kind: "import", id: "import" })))).status).toBe(409);
    expect(database.getImportDraft("import")?.status).toBe("draft");
    expect((await handler(request("x".repeat(2049)))).status).toBe(413);
    expect((await handler(request("{"))).status).toBe(400);
  });
  it("does not cancel saved memories or sales", async () => {
    const { database, cancel } = fixture();
    const conversation = database.readPortfolioAnalystConversation("chat")!;
    conversation.turns[0].chat!.memoryProposal!.status = "saved";
    conversation.turns[1].chat!.saleDraft!.status = "saved";
    database.savePortfolioAnalystConversation(conversation);
    expect((await cancel("memory", "memory")).status).toBe(409);
    expect((await cancel("sale", "sale")).status).toBe(409);
    expect(database.readPortfolioAnalystConversation("chat")).toEqual(conversation);
  });
});
