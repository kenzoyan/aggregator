import { describe, expect, it } from "vitest";
import { pendingAgentActions, currentAgentAction } from "@/components/agent-pending-actions";
import { createPortfolioAnalystConversation, type PortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import type { ImportDraftReadModel } from "@/application/imports/import-draft-read-model";

function fixture() {
  const conversation: PortfolioAnalystConversation = createPortfolioAnalystConversation({
    id: "chat", provider: "openai", language: "en", includeHoldingNames: true, now: "2026-10-11T10:00:00Z",
  });
  conversation.importActivities = [
    { draftId: "a", targetLabel: "Account A", submissionText: "", screenshotCount: 1, createdAt: "2026-10-11T10:01:00Z" },
    { draftId: "b", targetLabel: "Account B", submissionText: "", screenshotCount: 1, createdAt: "2026-10-11T10:02:00Z" },
  ];
  conversation.turns = [{ id: "memory", question: "Remember", createdAt: "2026-10-11T10:03:00Z",
    chat: { assistantText: "", memoryProposal: { content: "Use EUR", status: "pending" } } }];
  const drafts = Object.fromEntries(["a", "b"].map((id) => [id, { id, status: "draft" } as ImportDraftReadModel]));
  return { conversation, drafts };
}

describe("pending Agent actions", () => {
  it("restores all unfinished items and defaults to the most recent", () => {
    const { conversation, drafts } = fixture();
    const actions = pendingAgentActions(JSON.parse(JSON.stringify(conversation)), drafts);
    expect(actions.map((action) => action.key)).toEqual(["memory:memory", "import:b", "import:a"]);
    expect(currentAgentAction(actions)?.key).toBe("memory:memory");
  });
  it("keeps import and memory drafts pending while the user continues chatting", () => {
    const { conversation, drafts } = fixture();
    conversation.turns.push({ id: "follow-up", question: "Another question", createdAt: "2026-10-11T10:06:00Z",
      chat: { assistantText: "Answer" } });
    const restored = JSON.parse(JSON.stringify(conversation));
    expect(pendingAgentActions(restored, drafts).map((action) => action.key)).toEqual(["memory:memory", "import:b", "import:a"]);
    expect(restored.turns[0].chat.memoryProposal.status).toBe("pending");
  });
  it("keeps the selected item when its panel closes and restores a saved choice", () => {
    const { conversation, drafts } = fixture();
    const actions = pendingAgentActions(conversation, drafts);
    expect(currentAgentAction(actions, "import:a")?.id).toBe("a");
  });
  it("falls back after completion and ignores stale replies and cancelled activities", () => {
    const { conversation, drafts } = fixture();
    drafts.b.status = "confirmed";
    conversation.importActivities[0].cancelledAt = "2026-10-11T10:04:00Z";
    conversation.turns[0].chat!.memoryProposal!.status = "cancelled";
    const actions = pendingAgentActions(conversation, drafts);
    expect(actions).toEqual([]);
    expect(currentAgentAction(actions, "import:b")).toBeUndefined();
  });
  it("moves to another unfinished item after the selected item ends", () => {
    const { conversation, drafts } = fixture();
    drafts.b.status = "confirmed";
    expect(currentAgentAction(pendingAgentActions(conversation, drafts), "import:b")?.key).toBe("memory:memory");
  });
  it("uses recent import follow-ups for fallback and excludes missing drafts", () => {
    const { conversation, drafts } = fixture();
    conversation.importActivities[0].followUps = [{ id: "edit", userText: "Edit", assistantText: "Saved",
      createdAt: "2026-10-11T10:05:00Z" }];
    delete drafts.b;
    const actions = pendingAgentActions(conversation, drafts);
    expect(actions.map((action) => action.key)).toEqual(["import:a", "memory:memory"]);
    expect(currentAgentAction(actions, "import:missing")?.id).toBe("a");
    expect(pendingAgentActions(undefined, drafts)).toEqual([]);
  });
  it("distinguishes multiple memory proposals and removes only the resolved one", () => {
    const { conversation, drafts } = fixture();
    conversation.turns.push({ id: "memory-2", question: "Remember", createdAt: "2026-10-11T10:04:00Z",
      chat: { assistantText: "", memoryProposal: { content: "Use Chinese", status: "pending" } } });
    const actions = pendingAgentActions(conversation, drafts);
    expect(currentAgentAction(actions, "memory:memory")?.label).toBe("Use EUR");
    expect(currentAgentAction(actions, "memory:memory-2")?.label).toBe("Use Chinese");
    conversation.turns[1].chat!.memoryProposal!.status = "saved";
    expect(currentAgentAction(pendingAgentActions(conversation, drafts), "memory:memory-2")?.key).toBe("memory:memory");
  });
  it("includes each pending sale and memory by stable turn ID", () => {
    const { conversation, drafts } = fixture();
    conversation.turns.push({ id: "sale", question: "Sale", createdAt: "2026-10-11T10:04:00Z", chat: {
      assistantText: "", saleDraft: { status: "pending", fields: { sourceAccountId: "account" } } as NonNullable<PortfolioAnalystConversation["turns"][number]["chat"]>["saleDraft"],
    } });
    expect(pendingAgentActions(conversation, drafts)[0]).toMatchObject({ key: "sale:sale", id: "sale", kind: "sale" });
    conversation.turns[1].chat!.saleDraft!.status = "saved";
    expect(pendingAgentActions(conversation, drafts).some((action) => action.kind === "sale")).toBe(false);
  });
});
