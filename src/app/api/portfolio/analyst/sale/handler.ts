import { completePortfolioWorkflowReply, type WorkflowReplyGenerator } from "@/application/portfolio-workflow-reply";
import type { PortfolioWorkflowResult } from "@/application/portfolio-workflow-result";
import { createHash, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { matchSaleHolding, resolveSaleDraft, saleDraftFields, saleDraftFieldsSchema, saleScreenshotSchema, type AgentSaleDraft, type SaleDraftHolding } from "@/application/agent-sale-draft";
import { appendPortfolioAnalystTurn, type PortfolioAnalystConversation, type PortfolioAnalystConversationStore } from "@/application/portfolio-analyst-conversation";
import { prepareSaleReview, saleInputSchema } from "@/application/portfolio-sale";
import type { PortfolioFacts } from "@/infrastructure/sqlite/portfolio-repository-contract";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import type { PortfolioAnalystImageStore } from "@/infrastructure/local/portfolio-analyst-image-store";
import type { SaleExtractionRequest } from "@/infrastructure/openai/openai-sale-extractor";

const base = { conversationId: z.string().min(1).max(80) };
const createSchema = z.object({ ...base, sourceTurnId: z.string().min(1).max(80), accountId: z.string().max(200).optional() }).strict();
const editSchema = z.object({ ...base, turnId: z.string().min(1).max(80), fields: saleDraftFieldsSchema.optional(), text: z.string().trim().min(1).max(600).optional(), cancel: z.literal(true).optional() }).strict()
  .refine((value) => [value.fields, value.text, value.cancel].filter(Boolean).length === 1);
const reviewSchema = z.object({ ...base, turnId: z.string().min(1).max(80),
  confirm: z.boolean().default(false), reviewToken: z.string().length(64).optional(), duplicateAcknowledged: z.boolean().default(false) }).strict();
class RequestError extends Error { constructor(message: string, readonly status = 409, readonly code = "request-rejected") { super(message); } }
async function body(request: Request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > 16 * 1024) throw new RequestError("Sale draft request is too large.", 413);
  return JSON.parse(raw);
}
function currentConversation(store: PortfolioAnalystConversationStore, id: string) {
  const conversation = store.readPortfolioAnalystConversation(id);
  if (!conversation || store.readLatestPortfolioAnalystConversation()?.id !== id) throw new RequestError("Current conversation was not found.", 404);
  return conversation;
}
function pendingDraft(conversation: PortfolioAnalystConversation, id: string) {
  const turn = conversation.turns.find((item) => item.id === id);
  if (!turn?.chat?.saleDraft || turn.chat.saleDraft.status !== "pending") throw new RequestError("This sale draft is no longer pending.");
  return turn.chat.saleDraft;
}
function updateDraft(conversation: PortfolioAnalystConversation, id: string, draft: AgentSaleDraft, now: string, assistantText?: string) {
  return { ...conversation, updatedAt: now, turns: conversation.turns.map((turn) =>
    turn.id === id && turn.chat ? { ...turn, chat: { ...turn.chat, saleDraft: draft,
      ...(assistantText ? { assistantText } : {}) } } : turn) };
}
export function createAgentSaleHandlers(input: {
  conversations: PortfolioAnalystConversationStore;
  images: PortfolioAnalystImageStore;
  readFacts: () => PortfolioFacts;
  readHoldings: () => SaleDraftHolding[];
  confirmSale: PortfolioDatabase["confirmSale"];
  extract: (request: SaleExtractionRequest) => Promise<unknown>;
  respond: WorkflowReplyGenerator;
  now?: () => string; createId?: () => string;
}) {
  const now = input.now ?? (() => new Date().toISOString());
  const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
  const finish = async (conversation: PortfolioAnalystConversation, turnId: string, request: Request, extras: object = {}, status = 200) => {
    try { input.conversations.savePortfolioAnalystConversation(conversation); }
    catch { return response({ ...extras, conversation, replyUnavailable: true, replyTurnId: turnId }, status); }
    const reply = await completePortfolioWorkflowReply({ conversations: input.conversations, conversation, turnId, generate: input.respond, signal: request.signal });
    return response({ ...extras, ...reply }, status);
  };
  const resultTurn = (conversation: PortfolioAnalystConversation, result: PortfolioWorkflowResult, text?: string) => {
    const id = (input.createId ?? randomUUID)();
    return { id, conversation: appendPortfolioAnalystTurn(conversation, {
      id, question: text ?? "", ...(text ? { userText: text } : {}), createdAt: now(),
      chat: { assistantText: "", requestStatus: "pending", workflowResult: result },
    }) };
  };
  const handle = (operation: (request: Request) => Promise<Response>, operationName?: PortfolioWorkflowResult["operation"]) => async (request: Request) => {
    let reportInput: { conversationId?: string; text?: string; confirm?: boolean; cancel?: boolean; sourceTurnId?: string } = {};
    if (operationName) {
      try { const raw = await body(request.clone()); if (raw && typeof raw === "object" && !Array.isArray(raw)) reportInput = raw; } catch { /* invalid requests cannot supply a workflow context */ }
    }
    try { return await operation(request); } catch (error) {
      const status = error instanceof RequestError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 409;
      const details = error instanceof RequestError ? error.message
        : error instanceof z.ZodError || error instanceof SyntaxError ? "Invalid sale draft fields."
        : error instanceof Error && !("code" in error) ? error.message : "Sale analysis unavailable.";
      if (operationName && typeof reportInput.conversationId === "string" && !request.signal.aborted) {
        try {
          const current = currentConversation(input.conversations, reportInput.conversationId);
          const turn = resultTurn(current, { workflow: "sale", operation: reportInput.cancel ? "cancel" : operationName === "save" && !reportInput.confirm ? "review" : operationName, status: "failed", recordedAt: now(),
            portfolioChanged: false, code: error instanceof RequestError ? error.code : "operation-failed", details },
            typeof reportInput.text === "string" ? reportInput.text.slice(0, 600) : undefined);
          if (operationName === "prepare" && typeof reportInput.sourceTurnId === "string" &&
            !(error instanceof RequestError && error.code === "duplicate-image")) {
            const sourceTurnId = reportInput.sourceTurnId;
            turn.conversation = { ...turn.conversation, turns: turn.conversation.turns.map((item) =>
              item.id === turn.id && item.chat ? { ...item, chat: { ...item.chat,
                imageAction: { sourceTurnId, stage: "intent", purpose: "sale" } } } : item) };
          }
          return await finish(turn.conversation, turn.id, request, {}, status);
        } catch { /* No valid conversation is available for an Agent reply. */ }
      }
      return response({ error: details }, status);
    }
  };
  return {
    GET: handle(async (request) => {
      const id = new URL(request.url).searchParams.get("conversationId") ?? "";
      const conversation = currentConversation(input.conversations, id);
      return response({ conversation, holdings: input.readHoldings() });
    }),
    POST: handle(async (request) => {
      const parsed = createSchema.parse(await body(request));
      const conversation = currentConversation(input.conversations, parsed.conversationId);
      const source = conversation.turns.find((turn) => turn.id === parsed.sourceTurnId);
      if (source?.attachments?.length !== 1) throw new RequestError("Use one screenshot showing one completed sale.");
      const existing = conversation.turns.findLast((turn) => turn.chat?.saleDraft?.sourceTurnId === source.id && turn.chat.saleDraft.status !== "cancelled");
      if (existing?.chat?.saleDraft?.status === "saved") throw new RequestError("This screenshot already has a saved sale. Check holding History.", 409, "duplicate-image");
      if (existing) return response({ conversation, holdings: input.readHoldings() });
      if (conversation.turns.some((turn) => turn.chat?.saleDraft?.status === "pending")) throw new RequestError("Finish or cancel the current sale draft first.");
      const bytes = await input.images.read(source.attachments[0]);
      if (!bytes) throw new RequestError("The saved screenshot is unavailable.", 404);
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (input.readFacts().events.some((event) => !event.voidedAt && event.id.startsWith(`sale-image:${digest}:`))) throw new RequestError("This screenshot already has a saved sale. Check holding History.", 409, "duplicate-image");
      const extraction = saleScreenshotSchema.parse(await input.extract({ image: { bytes, mimeType: source.attachments[0].mimeType }, text: [source.userText ?? source.question, conversation.turns.at(-1)?.id !== source.id ? conversation.turns.at(-1)?.userText : undefined].filter(Boolean).join("\n"), signal: request.signal }));
      request.signal.throwIfAborted();
      if (extraction.status !== "completed") throw new RequestError("Use a completed sale confirmation showing one transaction. Pending orders and estimates cannot be recorded.");
      if (extraction.gross !== null && extraction.net !== null && extraction.fees !== null &&
        !new Decimal(extraction.gross).minus(extraction.fees).eq(extraction.net)) throw new RequestError("The screenshot amounts do not agree. Check the gross proceeds, fee and net received.");
      // Re-read after the model call; never overwrite a newer conversation.
      const latest = currentConversation(input.conversations, conversation.id);
      if (JSON.stringify(latest) !== JSON.stringify(conversation)) throw new RequestError("The conversation changed during analysis. Retry with the latest conversation.");
      const holdings = input.readHoldings();
      const accountMatches = extraction.accountName ? [...new Set(holdings.filter((holding) => holding.accountName === extraction.accountName).map((holding) => holding.sourceAccountId))] : [];
      const holding = matchSaleHolding(extraction, holdings, parsed.accountId ?? (accountMatches.length === 1 ? accountMatches[0] : undefined));
      const draft: AgentSaleDraft = { sourceTurnId: source.id, imageDigest: digest, status: "pending", extraction, fields: saleDraftFields(extraction, holding) };
      const next = appendPortfolioAnalystTurn(conversation, { id: (input.createId ?? randomUUID)(), question: "", createdAt: now(),
        chat: { assistantText: "", requestStatus: "pending", saleDraft: draft, workflowResult: {
          workflow: "sale", operation: "prepare", status: "succeeded", recordedAt: now(), portfolioChanged: false,
          draft: draft.fields, warnings: extraction.warnings,
          ...(holding ? { asset: { name: holding.name, accountName: holding.accountName, currency: holding.currency } } : {}),
        } } });
      return finish(next, next.turns.at(-1)!.id, request, { holdings });
    }, "prepare"),
    PATCH: handle(async (request) => {
      const parsed = editSchema.parse(await body(request));
      const conversation = currentConversation(input.conversations, parsed.conversationId);
      const draft = pendingDraft(conversation, parsed.turnId);
      if (parsed.cancel) {
        const updated = updateDraft(conversation, parsed.turnId, { ...draft, status: "cancelled" }, now());
        const turn = resultTurn(updated, { workflow: "sale", operation: "cancel", status: "succeeded", recordedAt: now(), portfolioChanged: false });
        return finish(turn.conversation, turn.id, request);
      }
      let cancelled = false;
      let fields = parsed.fields ?? draft.fields;
      if (parsed.text) {
        const extracted = saleScreenshotSchema.parse(await input.extract({ text: parsed.text, current: draft.fields, signal: request.signal }));
        request.signal.throwIfAborted();
        cancelled = extracted.status === "cancelled";
        if (extracted.status !== "completed" && extracted.status !== "cancelled") throw new RequestError("Tell me which sale details to change, or use Cancel draft to stop.");
        fields = { ...saleDraftFields(extracted), sourceAccountId: draft.fields.sourceAccountId, instrumentId: draft.fields.instrumentId };
        const latest = currentConversation(input.conversations, conversation.id);
        if (JSON.stringify(latest) !== JSON.stringify(conversation)) throw new RequestError("The draft changed during analysis. Retry.");
      }
      const updated = updateDraft(conversation, parsed.turnId, { ...draft, fields, ...(cancelled ? { status: "cancelled" as const } : {}) }, now());
      if (parsed.text) {
        const turn = resultTurn(updated, { workflow: "sale", operation: cancelled ? "cancel" : "update",
          status: "succeeded", recordedAt: now(), portfolioChanged: false, draft: fields }, parsed.text);
        return finish(turn.conversation, turn.id, request);
      }
      input.conversations.savePortfolioAnalystConversation(updated);
      return response({ conversation: updated });
    }, "update"),
    PUT: handle(async (request) => {
      const parsed = reviewSchema.parse(await body(request));
      const conversation = currentConversation(input.conversations, parsed.conversationId);
      const draft = pendingDraft(conversation, parsed.turnId);
      const holding = input.readHoldings().find((item) => item.sourceAccountId === draft.fields.sourceAccountId && item.instrumentId === draft.fields.instrumentId);
      if (!holding) throw new RequestError("Choose an available account and holding.");
      if (draft.extraction.currency && draft.extraction.currency !== holding.currency) throw new RequestError("The screenshot currency does not match this holding.");
      const resolved = resolveSaleDraft(draft.fields, holding);
      const sale = saleInputSchema.parse(resolved.sale);
      const facts = input.readFacts();
      if (facts.events.some((event) => !event.voidedAt && event.id.startsWith(`sale-image:${draft.imageDigest}:`))) throw new RequestError("This screenshot already has a saved sale. Check holding History.", 409, "duplicate-image");
      const similar = facts.events.some((event) => event.type === "sale" && !event.voidedAt &&
        event.sourceAccountId === sale.sourceAccountId && event.instrumentId === sale.instrumentId &&
        event.asOf.slice(0, 10) === sale.date && new Decimal(event.quantity).eq(sale.quantity) && new Decimal(event.proceeds.amount).eq(sale.proceeds));
      const review = prepareSaleReview(facts, sale);
      if (!parsed.confirm) return response({ preview: review.preview, reviewToken: review.reviewToken,
        quantity: sale.quantity, estimatedQuantity: resolved.estimatedQuantity, nav: resolved.nav, possibleDuplicate: similar });
      if (!parsed.reviewToken) throw new RequestError("Review this sale before confirming.");
      if (similar && !parsed.duplicateAcknowledged) throw new RequestError("A similar sale already exists. Check History and confirm that this is a separate transaction.");
      const eventId = `sale-image:${draft.imageDigest}:${facts.events.filter((event) => event.id.startsWith(`sale-image:${draft.imageDigest}:`)).length}`;
      const event = input.confirmSale(sale, parsed.reviewToken, eventId);
      const updated = updateDraft(conversation, parsed.turnId, { ...draft, status: "saved", eventId: event.id }, now());
      const turn = resultTurn(updated, { workflow: "sale", operation: "save", status: "succeeded", recordedAt: now(), portfolioChanged: true,
        asset: { name: holding.name, accountName: holding.accountName, currency: holding.currency },
        sale: { date: sale.date, quantity: sale.quantity, netProceeds: review.preview.netProceeds,
          realizedResult: review.preview.saleResult,
          destination: sale.destination.kind === "external-account" ? sale.destination.name : holding.accountName,
          excludedFromTrackedAssets: sale.destination.kind === "external-account" } });
      return finish(turn.conversation, turn.id, request, { event }, 201);
    }, "save"),
  };
}
