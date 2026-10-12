import { randomUUID } from "node:crypto";
import { appendPortfolioAnalystTurn } from "@/application/portfolio-analyst-conversation";
import { completePortfolioWorkflowReply, type WorkflowReplyGenerator } from "@/application/portfolio-workflow-reply";
import { z } from "zod";
import { currentPriceSourcePosition, PriceSourceError, type PriceSourceDatabase, type createPriceSourceService } from "@/application/price-source-service";
import type { PortfolioAnalystConversationStore } from "@/application/portfolio-analyst-conversation";

const schema = z.object({ conversationId: z.string().min(1).max(80), turnId: z.string().min(1).max(100), candidateId: z.string().min(1).max(100) }).strict();
export function createAgentPriceSourceConfirmHandler(input: {
  database: PriceSourceDatabase & PortfolioAnalystConversationStore;
  service: ReturnType<typeof createPriceSourceService>;
  now?: () => string;
  createId?: () => string;
  respond?: WorkflowReplyGenerator;
}) {
  return async (request: Request) => {
    const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 2048) return json({ error: "Request is too large." }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ error: "Choose a saved price source review." }, 400); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return json({ error: "Choose a saved price source review." }, 400);
    const { conversationId, turnId, candidateId } = parsed.data;
    const readReview = () => input.database.readLatestPortfolioAnalystConversation()?.id === conversationId
      ? input.database.readPortfolioAnalystConversation(conversationId) : undefined;
    const conversation = readReview();
    const review = conversation?.turns.find((turn) => turn.id === turnId)?.priceSourceReview;
    if (!conversation || !review) return json({ error: "Price source review was not found." }, 404);
    if (review.status === "cancelled") return json({ error: "This review was cancelled." }, 409);
    const candidate = review.candidates.find((item) => item.id === candidateId && item.quoteAvailable);
    if (!candidate) return json({ error: "Choose a verified candidate from this review." }, 409);
    const current = currentPriceSourcePosition(input.database, review.sourceAccountId, review.instrumentId)?.position;
    if (!current || current.instrumentCode !== review.instrumentCode || current.displayName !== review.instrumentName ||
        current.currency !== review.currency || current.assetType !== "fund") return json({ error: "The holding changed. Find its source again." }, 409);
    try {
      const { binding } = await input.service.confirm({ sourceAccountId: review.sourceAccountId, instrumentId: review.instrumentId, candidateId }, () => {
        const latest = readReview()?.turns.find((turn) => turn.id === turnId)?.priceSourceReview;
        return latest?.status === "pending" && latest.candidates.some((item) => item.id === candidateId && item.quoteAvailable) === true;
      });
      if (binding.provider !== candidate.provider || binding.instrumentCode !== candidate.instrumentCode) return json({ error: "A different source is already confirmed." }, 409);
      const latest = readReview();
      if (!latest) return json({ error: "Conversation changed. The saved source is available in holding detail." }, 409);
      const latestReview = latest.turns.find((turn) => turn.id === turnId)?.priceSourceReview ?? review;
      const replyTurnId = latestReview.confirmationReplyTurnId ?? (input.createId ?? randomUUID)();
      const updated = { ...latest, updatedAt: input.now?.() ?? new Date().toISOString(), turns: latest.turns.map((turn) =>
        turn.id === turnId ? { ...turn, priceSourceReview: { ...latestReview, binding, status: "saved" as const, confirmationReplyTurnId: replyTurnId } } : turn) };
      const conversationWithResult = updated.turns.some((turn) => turn.id === replyTurnId) ? updated : appendPortfolioAnalystTurn(updated, {
        id: replyTurnId, question: "", createdAt: updated.updatedAt,
        chat: { assistantText: "", requestStatus: "pending", workflowResult: {
          workflow: "price-source", operation: "save", status: "succeeded", recordedAt: binding.confirmedAt, portfolioChanged: false,
          priceSource: { sourceAccountId: binding.sourceAccountId, instrumentId: binding.instrumentId,
            instrumentCode: binding.instrumentCode, instrumentName: binding.instrumentName, provider: binding.provider,
            currency: binding.currency, shareClass: binding.shareClass, identityUrl: binding.identityUrl,
            confirmedAt: binding.confirmedAt, pricesUpdated: false, nextCheck: "manual-or-dashboard-daily" },
        } },
      });
      input.database.savePortfolioAnalystConversation(conversationWithResult);
      if (!input.respond) return json({ conversation: conversationWithResult, binding });
      const reply = await completePortfolioWorkflowReply({ conversations: input.database, conversation: conversationWithResult,
        turnId: replyTurnId, generate: input.respond, signal: request.signal });
      return json({ ...reply, binding });
    } catch (error) {
      if (error instanceof PriceSourceError) return json({ error: error.message }, error.status);
      return json({ error: "Price source could not be confirmed. Try again." }, 503);
    }
  };
}
