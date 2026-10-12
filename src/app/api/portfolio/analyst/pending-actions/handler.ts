import { z } from "zod";
import { resolvePortfolioAnalystMemoryProposal } from "@/application/portfolio-analyst-conversation";
import { createImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository-contract";

const cancelSchema = z.object({
  conversationId: z.string().trim().min(1).max(80),
  kind: z.enum(["import", "sale", "memory", "price-source"]),
  id: z.string().trim().min(1).max(100),
}).strict();
type Store = Pick<PortfolioDatabase, "readPortfolioAnalystConversation" | "readLatestPortfolioAnalystConversation"
  | "savePortfolioAnalystConversation" | "getImportDraft" | "discardImportDraft">;

// Explicit UI cancellation only. No model calls and no confirmed portfolio writes.
// Cancelling an already cancelled item returns its current state, so retries are safe.
export function createPendingActionCancelHandler(store: Store, now = () => new Date().toISOString()) {
  return async (request: Request) => {
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 2048) return json({ error: "Cancellation request is too large." }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "Cancellation request is invalid." }, 400); }
    const parsed = cancelSchema.safeParse(body);
    if (!parsed.success) return json({ error: "Cancellation request is invalid." }, 400);
    const { conversationId, kind, id } = parsed.data;
    const conversation = store.readPortfolioAnalystConversation(conversationId);
    if (!conversation || store.readLatestPortfolioAnalystConversation()?.id !== conversationId) {
      return json({ error: "Current conversation was not found." }, 404);
    }
    const timestamp = now();
    let updated = conversation;
    if (kind === "import") {
      const activity = conversation.importActivities.find((item) => item.draftId === id);
      if (!activity) return json({ error: "Import draft was not found in this conversation." }, 404);
      if (!activity.cancelledAt) {
        const draft = store.getImportDraft(id);
        if (!draft || draft.status !== "draft") return json({ error: "Import draft is no longer pending." }, 409);
        if (!store.discardImportDraft(id)) return json({ error: "Import draft could not be cancelled." }, 409);
        updated = { ...conversation, updatedAt: timestamp, importActivities: conversation.importActivities.map((item) =>
          item.draftId === id ? { ...item, cancelledAt: timestamp } : item) };
      }
    } else if (kind === "price-source") {
      const draft = conversation.turns.find((turn) => turn.id === id)?.priceSourceReview;
      if (!draft) return json({ error: "Price source review was not found." }, 404);
      if (draft.status === "saved") return json({ error: "Price source is already confirmed." }, 409);
      updated = { ...conversation, updatedAt: timestamp, turns: conversation.turns.map((turn) => turn.id === id
        ? { ...turn, priceSourceReview: { ...draft, status: "cancelled" as const } } : turn) };
    } else {
      const turn = conversation.turns.find((item) => item.id === id);
      const draft = kind === "memory" ? turn?.chat?.memoryProposal : turn?.chat?.saleDraft;
      if (!draft) return json({ error: "Draft was not found in this conversation." }, 404);
      if (draft.status === "saved") return json({ error: "Draft is already saved." }, 409);
      if (draft.status === "pending") {
        updated = kind === "memory" ? resolvePortfolioAnalystMemoryProposal(conversation, id, "cancelled", timestamp)
          : { ...conversation, updatedAt: timestamp, turns: conversation.turns.map((item) =>
            item.id === id && item.chat?.saleDraft ? { ...item, chat: { ...item.chat,
              saleDraft: { ...item.chat.saleDraft, status: "cancelled" as const } } } : item) };
      }
    }
    store.savePortfolioAnalystConversation(updated);
    const importDrafts = updated.importActivities.flatMap((activity) => {
      const draft = store.getImportDraft(activity.draftId);
      return draft ? [createImportDraftReadModel(draft)] : [];
    });
    return json({ conversation: updated, importDrafts });
  };
}
