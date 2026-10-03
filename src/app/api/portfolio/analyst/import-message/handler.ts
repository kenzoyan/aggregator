import { randomUUID } from "node:crypto";

import { z } from "zod";

import { createImportConfirmHandler } from "@/app/api/imports/[id]/confirm/handler";
import { createImportDraftReviewHandler } from "@/app/api/imports/[id]/review/handler";
import {
  appendPortfolioAnalystImportFollowUp,
  cancelPortfolioAnalystImport,
  normalizePortfolioAnalystConversation,
} from "@/application/portfolio-analyst-conversation";
import { importDateFollowUpQuestion, nextImportDateFollowUp } from "@/application/imports/import-chat-follow-up";
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
    if (prior) {
      const existing = input.database.getImportDraft(body.draftId);
      return json({ conversation, ...(existing ? { draft: createImportDraftReadModel(existing) } : {}),
        portfolioChanged: existing?.status === "confirmed", cancelled: Boolean(activity.cancelledAt) });
    }
    const draft = input.database.getImportDraft(body.draftId);
    if (!draft || draft.status !== "draft" || draft.sourceKind !== "screenshot" || activity.cancelledAt) {
      return json({ error: "There is no active screenshot draft to update." }, 409);
    }
    const reviewed = createImportDraftReadModel(draft);
    let decision;
    try {
      decision = resolveImportMessageDecision(await input.interpreter.interpret({
        message: body.message,
        draft: reviewed,
        language: conversation.language,
        recentConversation: (activity.followUps ?? []).slice(-3).flatMap((item) => [
          { role: "user" as const, text: item.userText },
          { role: "assistant" as const, text: item.assistantText },
        ]),
        signal: request.signal,
      }), body.message, reviewed, conversation.language);
    } catch {
      return json({ error: "I couldn't understand that request. Your draft has not changed; please try again." }, 502);
    }
    if (decision.intent === "other") return json({ delegate: true });

    let assistantText: string;
    let resultingDraft = draft;
    let portfolioChanged = false;
    let cancelled = false;
    const language = conversation.language;
    if (decision.intent === "reply") {
      assistantText = decision.reply;
    } else if (decision.intent === "cancel") {
      if (input.database.discardImportDraft(draft.id)) {
        cancelled = true;
        assistantText = language === "zh-CN"
          ? "已取消这次导入并删除未确认的草稿。持仓没有变化。"
          : "I cancelled this import and removed the unconfirmed draft. Your holdings were not changed.";
      } else {
        assistantText = language === "zh-CN" ? "未能取消草稿，请刷新后重试。" : "I couldn't cancel the draft. Please refresh and try again.";
      }
    } else if (decision.intent === "confirm") {
      const response = await createImportConfirmHandler({
        database: input.database,
        newId: input.createId ?? randomUUID,
        now: input.now ?? (() => new Date().toISOString()),
      })(new Request(`http://localhost/api/imports/${encodeURIComponent(draft.id)}/confirm`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(createImportDraftConfirmationPayload(reviewed)),
      }), draft.id);
      const payload = await response.json() as { error?: string; draft?: ReturnType<typeof createImportDraftReadModel> };
      resultingDraft = input.database.getImportDraft(draft.id) ?? draft;
      portfolioChanged = resultingDraft.status === "confirmed";
      assistantText = portfolioChanged
        ? (language === "zh-CN" ? `已确认 ${activity.targetLabel} 的导入，资产已更新。` : `I confirmed the import for ${activity.targetLabel}. Your assets are updated.`)
        : (language === "zh-CN" ? `还未更新资产：${payload.error ?? "请检查右侧草稿。"}` : `I haven't updated your assets: ${payload.error ?? "Please review the draft on the right."}`);
    } else {
      let edit;
      let label = "";
      if (decision.intent === "set-date") {
        if (decision.field === "valuation-date") {
          edit = { type: "update-as-of" as const, value: decision.value };
        } else {
          const index = reviewed.portfolio.holdings.findIndex((item) => item.lineId === decision.holdingLineId);
          if (index < 0) return json({ error: "The holding was not found in the draft." }, 409);
          label = reviewed.portfolio.holdings[index]!.displayName || reviewed.portfolio.holdings[index]!.instrumentId;
          edit = { type: "update-holding" as const, index, field: "priceAsOf" as const, value: decision.value };
        }
      } else {
        const index = decision.holdingLineId
          ? reviewed.portfolio.holdings.findIndex((item) => item.lineId === decision.holdingLineId)
          : reviewed.portfolio.holdings.length === 1 ? 0 : -1;
        if (index < 0) {
          assistantText = language === "zh-CN" ? "这个代码属于哪一项持仓？" : "Which holding should receive that code?";
          const next = appendPortfolioAnalystImportFollowUp(conversation, draft.id, {
            id: body.id, userText: body.message, assistantText,
            createdAt: input.now?.() ?? new Date().toISOString(),
          });
          input.database.savePortfolioAnalystConversation(next);
          return json({ conversation: next, draft: reviewed, portfolioChanged: false });
        }
        label = reviewed.portfolio.holdings[index]!.displayName || reviewed.portfolio.holdings[index]!.instrumentId;
        edit = { type: "update-holding" as const, index, field: "instrumentCode" as const, value: decision.value };
      }
      const changed = applyImportDraftEdit(reviewed, edit);
      const response = await createImportDraftReviewHandler(input.database)(new Request(
        `http://localhost/api/imports/${encodeURIComponent(draft.id)}/review`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify(createImportDraftConfirmationPayload(changed)),
        }), draft.id);
      const payload = await response.json() as { error?: string };
      resultingDraft = input.database.getImportDraft(draft.id) ?? draft;
      if (!response.ok) {
        assistantText = language === "zh-CN" ? `草稿未更新：${payload.error ?? "请检查右侧草稿。"}` : `I couldn't update the draft: ${payload.error ?? "Please review it on the right."}`;
      } else if (decision.intent === "set-code") {
        assistantText = language === "zh-CN" ? `已将 ${decision.value} 填入 ${label} 的代码栏。` : `I saved ${decision.value} as the code for ${label}.`;
      } else {
        assistantText = decision.field === "valuation-date"
          ? (language === "zh-CN" ? `已记录估值日期 ${decision.value}。` : `I saved ${decision.value} as the valuation date.`)
          : (language === "zh-CN" ? `已记录 ${label} 的价格日期 ${decision.value}。` : `I saved ${decision.value} as the price date for ${label}.`);
        const nextQuestion = nextImportDateFollowUp(createImportDraftReadModel(resultingDraft));
        if (nextQuestion) assistantText += `\n${importDateFollowUpQuestion(nextQuestion, language)}`;
      }
    }

    const createdAt = input.now?.() ?? new Date().toISOString();
    const next = cancelled
      ? cancelPortfolioAnalystImport(conversation, draft.id, { id: body.id, userText: body.message, cancelledAt: createdAt })
      : appendPortfolioAnalystImportFollowUp(conversation, draft.id, {
          id: body.id, userText: body.message, assistantText, createdAt,
        });
    input.database.savePortfolioAnalystConversation(next);
    return json({ conversation: next, ...(cancelled ? {} : { draft: createImportDraftReadModel(resultingDraft) }),
      portfolioChanged, cancelled });
  };
}

export async function POST(request: Request) {
  const database = getPortfolioDatabase();
  const registry = getPortfolioAnalystProviderRegistry();
  const conversation = database.readLatestPortfolioAnalystConversation();
  const provider = conversation?.provider ?? registry.defaultProvider;
  const apiKey = provider === "openai" ? process.env.OPENAI_API_KEY : process.env.DEEPSEEK_API_KEY;
  if (!apiKey?.trim()) return json({ error: "Assistant configuration is unavailable." }, 503);
  const interpreter = createImportMessageInterpreter({
    provider, apiKey: apiKey.trim(), model: registry.models[provider],
  });
  return createImportMessageHandler({ database, interpreter })(request);
}
