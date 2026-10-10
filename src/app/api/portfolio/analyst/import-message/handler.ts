import { completePortfolioWorkflowReply, type WorkflowReplyGenerator } from "@/application/portfolio-workflow-reply";
import type { PortfolioWorkflowResult } from "@/application/portfolio-workflow-result";
import { createPortfolioWorkflowReply } from "@/server/portfolio-workflow-reply";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { createImportConfirmHandler } from "@/app/api/imports/[id]/confirm/handler";
import { createImportDraftReviewHandler } from "@/app/api/imports/[id]/review/handler";
import {
  appendPortfolioAnalystTurn,
  normalizePortfolioAnalystConversation,
} from "@/application/portfolio-analyst-conversation";
import { createImportWorkflowResult } from "@/application/imports/import-workflow-result";
import { createImportDraftConfirmationPayload, createImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import { applyImportDraftEdit } from "@/application/imports/import-review-editor";
import { resolveImportMessageDecision, type ImportMessageInterpreter } from "@/application/imports/import-message-intent";
import type { PortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository-contract";
import { createImportMessageInterpreter } from "@/infrastructure/responses/import-message-interpreter";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import { getPortfolioAnalystProviderRegistry } from "@/server/portfolio-analyst-config";

const requestSchema = z.object({
  id: z.uuid(),
  conversationId: z.string().trim().min(1).max(80),
  draftId: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(600),
}).strict();

type ImportMessageDatabase = Pick<PortfolioDatabase,
  "readLatestPortfolioAnalystConversation" | "readPortfolioAnalystConversation" |
  "savePortfolioAnalystConversation" | "getImportDraft" | "saveImportDraftReview" |
  "confirmImport" | "discardImportDraft" | "readPortfolioFacts"
>;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function createImportMessageHandler(input: {
  database: ImportMessageDatabase;
  interpreter: ImportMessageInterpreter;
  respond?: WorkflowReplyGenerator;
  allowConfirmation?: boolean;
  now?: () => string;
  createId?: () => string;
}) {
  return async (request: Request) => {
    let body: z.infer<typeof requestSchema>;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 8 * 1024) return json({ error: "Message is too large." }, 413);
      body = requestSchema.parse(JSON.parse(raw));
    } catch {
      return json({ error: "Import message is invalid." }, 400);
    }
    const stored = input.database.readPortfolioAnalystConversation(body.conversationId);
    const conversation = stored && normalizePortfolioAnalystConversation(stored);
    if (!conversation || input.database.readLatestPortfolioAnalystConversation()?.id !== conversation.id) {
      return json({ error: "The current conversation was not found." }, 409);
    }
    const activity = conversation.importActivities.find((item) => item.draftId === body.draftId);
    if (!activity) return json({ error: "This draft does not belong to the conversation." }, 404);
    const prior = activity.followUps?.find((item) => item.id === body.id);
    if (prior || conversation.turns.some((turn) => turn.id === body.id && turn.chat?.workflowResult?.importDraft?.id === body.draftId)) {
      const existing = input.database.getImportDraft(body.draftId);
      return json({ conversation, ...(existing ? { draft: createImportDraftReadModel(existing) } : {}),
        portfolioChanged: existing?.status === "confirmed", cancelled: Boolean(activity.cancelledAt) });
    }
    const draft = input.database.getImportDraft(body.draftId);
    if (!draft || draft.status !== "draft" || draft.sourceKind !== "screenshot" || activity.cancelledAt) {
      return json({ error: "There is no active screenshot draft to update." }, 409);
    }
    const reviewed = createImportDraftReadModel(draft);
    let resultingDraft = draft;
    let portfolioChanged = false;
    let cancelled = false;
    const finish = async (operation: PortfolioWorkflowResult["operation"], status: "succeeded" | "failed", details?: string, code?: string) => {
      const createdAt = input.now?.() ?? new Date().toISOString();
      const latest = input.database.readPortfolioAnalystConversation(conversation.id);
      if (!latest || input.database.readLatestPortfolioAnalystConversation()?.id !== conversation.id) return json({ error: "Conversation changed." }, 409);
      const model = createImportDraftReadModel(resultingDraft);
      const result = createImportWorkflowResult({ draft: resultingDraft, accountName: activity.targetLabel,
        operation, status, recordedAt: createdAt, portfolioChanged, cancelled, details, code });
      const next = appendPortfolioAnalystTurn({ ...latest, importActivities: latest.importActivities.map((item) =>
        item.draftId === draft.id && cancelled ? { ...item, cancelledAt: createdAt } : item) }, {
        id: body.id, question: body.message, userText: body.message, createdAt,
        chat: { assistantText: "", requestStatus: "pending", workflowResult: result },
      });
      input.database.savePortfolioAnalystConversation(next);
      const reply = input.respond ? await completePortfolioWorkflowReply({ conversations: input.database, conversation: next,
        turnId: body.id, generate: input.respond, signal: request.signal }) : { conversation: next, replyUnavailable: true, replyTurnId: body.id };
      return json({ ...reply, ...(cancelled ? {} : { draft: model }), portfolioChanged, cancelled });
    };
    let decision;
    try {
      decision = resolveImportMessageDecision(await input.interpreter.interpret({
        message: body.message, draft: reviewed, language: conversation.language,
        recentConversation: [
          ...(activity.followUps ?? []).slice(-3).flatMap((item) => [
            { role: "user" as const, text: item.userText }, { role: "assistant" as const, text: item.assistantText },
          ]),
          ...conversation.turns.filter((turn) => turn.chat?.workflowResult?.importDraft?.id === draft.id).slice(-3).flatMap((turn) => [
            { role: "user" as const, text: turn.userText ?? turn.question }, { role: "assistant" as const, text: turn.chat!.assistantText },
          ]),
        ].slice(-6), signal: request.signal,
      }), body.message, reviewed, conversation.language);
    } catch {
      return finish("update", "failed", undefined, "interpretation-unavailable");
    }
    request.signal.throwIfAborted();
    // The interpreter is not allowed to overwrite changes made while its request was running.
    if (JSON.stringify(input.database.getImportDraft(draft.id)) !== JSON.stringify(draft) ||
      JSON.stringify(input.database.readPortfolioAnalystConversation(conversation.id)) !== JSON.stringify(stored)) {
      return finish("update", "failed", undefined, "draft-changed");
    }
    if (decision.intent === "other") return json({ delegate: true });
    if (decision.intent === "reply") return finish("review", "succeeded", decision.reply);
    if (decision.intent === "cancel") {
      cancelled = input.database.discardImportDraft(draft.id);
      return finish("cancel", cancelled ? "succeeded" : "failed");
    }
    if (decision.intent === "confirm") {
      if (input.allowConfirmation === false) return finish("review", "succeeded", undefined, "explicit-confirmation-required");
      const response = await createImportConfirmHandler({ database: input.database, newId: input.createId ?? randomUUID,
        now: input.now ?? (() => new Date().toISOString()),
      })(new Request(`http://localhost/api/imports/${encodeURIComponent(draft.id)}/confirm`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(createImportDraftConfirmationPayload(reviewed)),
      }), draft.id);
      const payload = await response.json() as { error?: string };
      resultingDraft = input.database.getImportDraft(draft.id) ?? draft;
      portfolioChanged = resultingDraft.status === "confirmed";
      return finish("save", portfolioChanged ? "succeeded" : "failed", payload.error);
    }
    let edit;
    if (decision.intent === "set-date" && decision.field === "valuation-date") {
      edit = { type: "update-as-of" as const, value: decision.value };
    } else {
      const index = decision.holdingLineId ? reviewed.portfolio.holdings.findIndex((item) => item.lineId === decision.holdingLineId)
        : reviewed.portfolio.holdings.length === 1 ? 0 : -1;
      if (index < 0) return finish("update", "failed", undefined, "holding-required");
      edit = { type: "update-holding" as const, index,
        field: decision.intent === "set-code" ? "instrumentCode" as const : "priceAsOf" as const, value: decision.value };
    }
    const changed = applyImportDraftEdit(reviewed, edit);
    const response = await createImportDraftReviewHandler(input.database)(new Request(
      `http://localhost/api/imports/${encodeURIComponent(draft.id)}/review`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(createImportDraftConfirmationPayload(changed)),
      }), draft.id);
    const payload = await response.json() as { error?: string };
    resultingDraft = input.database.getImportDraft(draft.id) ?? draft;
    return finish("update", response.ok ? "succeeded" : "failed", payload.error);

  };
}

export async function POST(request: Request) {
  const database = getPortfolioDatabase();
  const registry = getPortfolioAnalystProviderRegistry();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey?.trim()) return json({ error: "Assistant configuration is unavailable." }, 503);
  const interpreter = createImportMessageInterpreter({
    apiKey: apiKey.trim(), model: registry.models.openai,
  });
  return createImportMessageHandler({ database, interpreter, respond: createPortfolioWorkflowReply(database) })(request);
}
