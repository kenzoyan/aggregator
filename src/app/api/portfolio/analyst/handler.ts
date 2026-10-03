import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type { PortfolioAnalystAgentAudit } from "@/application/portfolio-analyst-agent";
import {
  appendPortfolioAnalystImportFollowUp,
  attachPortfolioAnalystImport,
  appendPortfolioAnalystTurn,
  cancelPortfolioAnalystImport,
  createPortfolioAnalystConversation,
  createPortfolioAnalystHistory,
  normalizePortfolioAnalystConversation,
  type PortfolioAnalystImageAttachment,
  type PortfolioAnalystConversationStore,
} from "@/application/portfolio-analyst-conversation";
import {
  createImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
import { importDateClarificationQuestion, importDateFollowUpQuestion, nextImportDateFollowUp } from "@/application/imports/import-chat-follow-up";
import {
  PortfolioAnalystContextError,
  type AnalystEvidenceFact,
  type AnalystPortfolioReadModel,
  type PortfolioAnalystContextV1,
} from "@/application/portfolio-analyst-contract";
import { createPortfolioAnalystTools } from "@/application/portfolio-analyst-tools";
import {
  portfolioAnalystProviderIds,
  PortfolioAnalystProviderError,
  type PortfolioAnalystReport,
} from "@/application/portfolio-analyst-provider";
import type { PortfolioAnalystSessionFactory } from "@/application/portfolio-analyst-session";
import type { SourceAccountDefinition } from "@/domain/source-accounts";
import type { StoredImportDraft } from "@/domain/imports";
import {
  portfolioAnalystStreamContentType,
  type PortfolioAnalystStreamEvent,
} from "@/application/portfolio-analyst-stream";
import { piPortfolioAnalystSessionFactory } from "@/infrastructure/pi/pi-portfolio-analyst-session";
import { createLocalPortfolioAnalystImageStore } from "@/infrastructure/local/portfolio-analyst-image-store";
import { getPortfolioDatabase } from "@/server/portfolio-db";
import {
  getPortfolioAnalystProviderRegistry,
  type PortfolioAnalystProviderRegistry,
} from "@/server/portfolio-analyst-config";
import { readPortfolioOverviewIncludingEmpty } from "@/server/current-portfolio";

const MAX_REQUEST_BYTES = 8 * 1024;
const commonRequest = {
  provider: z.enum(portfolioAnalystProviderIds),
  language: z.enum(["en", "zh-CN"]),
  includeHoldingNames: z.boolean(),
  conversationId: z.string().trim().min(1).max(80).optional(),
  question: z.string().trim().min(1).max(600).optional(),
};
const legacyRequestSchema = z.discriminatedUnion("job", [
  z.object({
    ...commonRequest,
    job: z.literal("explain-period-drivers"),
    period: z.enum(["today", "week", "month"]),
  }).strict(),
  z.object({
    ...commonRequest,
    job: z.literal("diagnose-data-quality"),
  }).strict(),
]);
const agentRequestSchema = z.object({
  ...commonRequest,
  mode: z.literal("agent"),
  defaultPeriod: z.enum(["today", "week", "month"]),
  question: z.string().trim().min(1).max(600),
  screenshotCount: z.number().int().min(1).max(6).optional(),
}).strict();
const requestSchema = z.union([agentRequestSchema, legacyRequestSchema]);
const importActivitySchema = z.object({
  conversationId: z.string().trim().min(1).max(80),
  draftId: z.string().trim().min(1).max(100),
  targetLabel: z.string().trim().min(1).max(120),
  submissionText: z.string().trim().max(600),
  screenshotCount: z.number().int().min(1).max(6),
}).strict();
const importFollowUpSchema = z.object({
  mode: z.literal("import-date-follow-up"),
  id: z.uuid(),
  conversationId: z.string().trim().min(1).max(80),
  draftId: z.string().trim().min(1).max(100),
  userText: z.string().trim().min(1).max(100),
  field: z.enum(["valuation-date", "price-date"]),
  value: z.iso.date(),
  holdingLineId: z.string().trim().min(1).max(100).optional(),
}).strict();
const importCodeFollowUpSchema = z.object({
  mode: z.literal("import-code-follow-up"),
  id: z.uuid(),
  conversationId: z.string().trim().min(1).max(80),
  draftId: z.string().trim().min(1).max(100),
  userText: z.string().trim().min(1).max(600),
  holdingLineId: z.string().trim().min(1).max(100),
  value: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,31}$/),
}).strict();
const importClarificationSchema = z.object({
  mode: z.literal("import-clarification"),
  id: z.uuid(),
  conversationId: z.string().trim().min(1).max(80),
  draftId: z.string().trim().min(1).max(100),
  userText: z.string().trim().min(1).max(600),
  reason: z.enum(["date", "code-target"]),
}).strict();
const importConfirmationFollowUpSchema = z.object({
  mode: z.literal("import-confirm-follow-up"),
  id: z.uuid(),
  conversationId: z.string().trim().min(1).max(80),
  draftId: z.string().trim().min(1).max(100),
  userText: z.string().trim().min(1).max(600),
}).strict();
const cancelImportSchema = z.object({
  mode: z.literal("cancel-import"),
  id: z.uuid(),
  conversationId: z.string().trim().min(1).max(80),
  draftId: z.string().trim().min(1).max(100),
  userText: z.string().trim().min(1).max(600),
}).strict();
type AnalystApiRequest = z.infer<typeof requestSchema>;

const providerNames = { openai: "OpenAI", deepseek: "DeepSeek" } as const;

const defaultQuestions = {
  en: {
    "explain-period-drivers": "Explain the performance drivers for the selected period.",
    "diagnose-data-quality": "Diagnose the current portfolio data quality.",
  },
  "zh-CN": {
    "explain-period-drivers": "请解释所选期间的表现驱动因素。",
    "diagnose-data-quality": "请诊断当前投资组合的数据质量。",
  },
} as const;

function requestQuestion(body: AnalystApiRequest): string {
  if ("mode" in body) return body.question;
  return body.question ?? defaultQuestions[body.language][body.job];
}

function requestDefaultPeriod(body: AnalystApiRequest) {
  if ("mode" in body) return body.defaultPeriod;
  return body.job === "explain-period-drivers" ? body.period : "week";
}

function runtimeQuestion(body: AnalystApiRequest): string {
  const question = requestQuestion(body);
  if (!("mode" in body) || !body.screenshotCount) return question;
  return `The user attached ${body.screenshotCount} screenshot(s). Their image contents are not visible in this text turn. Read the registered accounts and use prepare_account_import when the user's text clearly identifies one. Do not claim to have read or extracted the images; the application will analyze them after account selection. User request: ${question}`;
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { "cache-control": "no-store", ...init?.headers },
  });
}

function citedEvidence(
  context: PortfolioAnalystContextV1,
  answer: PortfolioAnalystAnswer,
): AnalystEvidenceFact[] {
  const keys = new Set([
    ...answer.answer.evidence,
    ...answer.claims.flatMap((claim) => claim.evidence),
    ...answer.limitations.map((limitation) => limitation.evidenceKey),
    ...(answer.proposedUpdate ? [answer.proposedUpdate.reasonEvidenceKey] : []),
  ]);
  return context.facts.filter((fact) => keys.has(fact.key));
}

export function createPortfolioAnalystHandlers(
  registry: PortfolioAnalystProviderRegistry,
  options: {
    readCurrentPortfolio: () => AnalystPortfolioReadModel | undefined;
    readSourceAccounts?: () => SourceAccountDefinition[];
    now?: () => string;
    createId?: () => string;
    conversations?: PortfolioAnalystConversationStore;
    deleteImage?: (attachment: PortfolioAnalystImageAttachment) => Promise<void>;
    getImportDraft?: (id: string) => StoredImportDraft | undefined;
    discardImportDraft?: (id: string) => boolean;
    sessionFactory?: PortfolioAnalystSessionFactory;
  },
) {
  return {
    async GET() {
      const stored = options.conversations?.readLatestPortfolioAnalystConversation();
      const conversation = stored && normalizePortfolioAnalystConversation(stored);
      const importDrafts = conversation?.importActivities.flatMap((activity) => {
        const draft = options.getImportDraft?.(activity.draftId);
        return draft ? [createImportDraftReadModel(draft)] : [];
      }) ?? [];
      return json({
        defaultProvider: registry.defaultProvider,
        providers: portfolioAnalystProviderIds.map((id) => ({
          id,
          configured: Boolean(registry.providers[id]),
          model: registry.models[id],
        })),
        ...(conversation ? { conversation } : {}),
        ...(importDrafts.length ? { importDrafts } : {}),
      });
    },

    async PATCH(request: Request) {
      let body: z.infer<typeof importActivitySchema> | z.infer<typeof importFollowUpSchema> |
        z.infer<typeof importCodeFollowUpSchema> | z.infer<typeof importClarificationSchema> |
        z.infer<typeof importConfirmationFollowUpSchema> |
        z.infer<typeof cancelImportSchema>;
      try {
        body = z.union([importActivitySchema, importFollowUpSchema, importCodeFollowUpSchema,
          importClarificationSchema, importConfirmationFollowUpSchema, cancelImportSchema]).parse(await request.json());
      } catch {
        return json(
          { error: "Import activity request is invalid.", code: "invalid-request" },
          { status: 400 },
        );
      }
      const stored = options.conversations
        ?.readPortfolioAnalystConversation(body.conversationId);
      const conversation = stored && normalizePortfolioAnalystConversation(stored);
      if (!conversation) {
        return json(
          { error: "Analyst conversation was not found.", code: "conversation-not-found" },
          { status: 404 },
        );
      }
      if ("mode" in body && body.mode === "import-confirm-follow-up") {
        if (options.conversations?.readLatestPortfolioAnalystConversation()?.id !== conversation.id) {
          return json({ error: "Only the current conversation can receive import replies." }, { status: 409 });
        }
        const activity = conversation.importActivities.find((item) => item.draftId === body.draftId);
        const draft = options.getImportDraft?.(body.draftId);
        if (!activity || !draft || draft.status !== "confirmed" || draft.sourceKind !== "screenshot") {
          return json({ error: "The import has not been confirmed." }, { status: 409 });
        }
        const assistantText = conversation.language === "zh-CN"
          ? `已确认 ${activity.targetLabel} 的导入，资产已更新。`
          : `I confirmed the import for ${activity.targetLabel}. Your assets are updated.`;
        const next = appendPortfolioAnalystImportFollowUp(conversation, body.draftId, {
          id: body.id, userText: body.userText, assistantText,
          createdAt: options.now?.() ?? new Date().toISOString(),
        });
        options.conversations?.savePortfolioAnalystConversation(next);
        return json({ conversation: next, importDraft: createImportDraftReadModel(draft) });
      }
      if ("mode" in body && body.mode === "cancel-import") {
        if (options.conversations?.readLatestPortfolioAnalystConversation()?.id !== conversation.id) {
          return json({ error: "Only the current conversation can cancel an import." }, { status: 409 });
        }
        const activity = conversation.importActivities.find((item) => item.draftId === body.draftId);
        if (!activity) return json({ error: "This import is not part of the conversation." }, { status: 404 });
        if (activity.cancelledAt) return json({ conversation, cancelled: true });
        const draft = options.getImportDraft?.(body.draftId);
        if (!draft) return json({ error: "The import draft was not found." }, { status: 404 });
        if (draft.status !== "draft") {
          return json({ error: "A confirmed import cannot be cancelled." }, { status: 409 });
        }
        if (!options.discardImportDraft) {
          return json({ error: "Import cancellation is unavailable." }, { status: 503 });
        }
        try {
          if (!options.discardImportDraft(body.draftId)) {
            return json({ error: "The import draft changed before cancellation." }, { status: 409 });
          }
          const next = cancelPortfolioAnalystImport(conversation, body.draftId, {
            id: body.id, userText: body.userText,
            cancelledAt: options.now?.() ?? new Date().toISOString(),
          });
          options.conversations?.savePortfolioAnalystConversation(next);
          return json({ conversation: next, cancelled: true });
        } catch {
          return json({ error: "The import could not be cancelled. Please try again." }, { status: 500 });
        }
      }
      if ("mode" in body && (body.mode === "import-code-follow-up" || body.mode === "import-clarification")) {
        if (options.conversations?.readLatestPortfolioAnalystConversation()?.id !== conversation.id) {
          return json({ error: "Only the current conversation can receive import replies." }, { status: 409 });
        }
        const activity = conversation.importActivities.find((item) => item.draftId === body.draftId);
        const draft = options.getImportDraft?.(body.draftId);
        if (!activity || !draft || draft.status !== "draft" || draft.sourceKind !== "screenshot") {
          return json({ error: "The active import draft was not found." }, { status: 404 });
        }
        const reviewed = createImportDraftReadModel(draft);
        let assistantText: string;
        if (body.mode === "import-code-follow-up") {
          const holding = reviewed.portfolio.holdings.find((item) => item.lineId === body.holdingLineId);
          if (!holding || holding.instrumentCode !== body.value) {
            return json({ error: "The code was not saved in the draft." }, { status: 409 });
          }
          const label = holding.displayName || holding.instrumentId || "holding";
          assistantText = conversation.language === "zh-CN"
            ? `已将 ${body.value} 填入 ${label} 的代码栏。请检查右侧草稿。`
            : `I saved ${body.value} as the code for ${label}. Please review the draft on the right.`;
        } else if (body.reason === "date") {
          if (!nextImportDateFollowUp(reviewed)) {
            return json({ error: "The draft no longer needs a date." }, { status: 409 });
          }
          assistantText = importDateClarificationQuestion(body.userText, conversation.language);
        } else {
          assistantText = conversation.language === "zh-CN"
            ? "这个草稿有多项持仓。请在回复中同时写出持仓名称和代码，或者在右侧草稿中填写。"
            : "This draft has more than one holding. Please reply with both the holding name and its code, or enter it in the draft on the right.";
        }
        const next = appendPortfolioAnalystImportFollowUp(conversation, body.draftId, {
          id: body.id, userText: body.userText, assistantText,
          createdAt: options.now?.() ?? new Date().toISOString(),
        });
        options.conversations?.savePortfolioAnalystConversation(next);
        return json({ conversation: next, importDraft: reviewed });
      }
      if ("mode" in body) {
        if (options.conversations?.readLatestPortfolioAnalystConversation()?.id !== conversation.id) {
          return json({ error: "Only the current conversation can receive import replies." }, { status: 409 });
        }
        const activity = conversation.importActivities.find((item) => item.draftId === body.draftId);
        const draft = options.getImportDraft?.(body.draftId);
        if (!activity || !draft || draft.status !== "draft" || draft.sourceKind !== "screenshot") {
          return json({ error: "The active import draft was not found." }, { status: 404 });
        }
        const reviewed = createImportDraftReadModel(draft);
        const holding = body.holdingLineId
          ? reviewed.portfolio.holdings.find((item) => item.lineId === body.holdingLineId)
          : undefined;
        const matches = body.field === "valuation-date"
          ? !body.holdingLineId && reviewed.portfolio.asOf.slice(0, 10) === body.value
          : Boolean(holding && holding.priceAsOf?.slice(0, 10) === body.value);
        if (!matches) return json({ error: "The date was not saved in the draft." }, { status: 409 });
        const label = holding?.displayName || holding?.instrumentId || "holding";
        const acknowledgement = body.field === "valuation-date"
          ? (conversation.language === "zh-CN" ? `已记录估值日期 ${body.value}。请检查右侧草稿。` : `I saved ${body.value} as the valuation date. Please review the draft on the right.`)
          : (conversation.language === "zh-CN" ? `已记录 ${label} 的价格日期 ${body.value}。请检查右侧草稿。` : `I saved ${body.value} as the price date for ${label}. Please review the draft on the right.`);
        const nextQuestion = nextImportDateFollowUp(reviewed);
        const assistantText = nextQuestion
          ? `${acknowledgement}\n${importDateFollowUpQuestion(nextQuestion, conversation.language)}`
          : acknowledgement;
        const next = appendPortfolioAnalystImportFollowUp(conversation, body.draftId, {
          id: body.id, userText: body.userText, assistantText,
          createdAt: options.now?.() ?? new Date().toISOString(),
        });
        options.conversations?.savePortfolioAnalystConversation(next);
        return json({ conversation: next, importDraft: reviewed });
      }
      const draft = options.getImportDraft?.(body.draftId);
      if (!draft) {
        return json(
          { error: "Import draft was not found.", code: "import-draft-not-found" },
          { status: 404 },
        );
      }
      if (draft.sourceKind !== "screenshot") {
        return json(
          { error: "Only screenshot drafts can be attached to this conversation.", code: "invalid-import-kind" },
          { status: 400 },
        );
      }
      const targetLabel = options.readSourceAccounts?.().find(
        (account) => account.id === draft.sourceAccountId,
      )?.label ?? body.targetLabel;
      const nextConversation = attachPortfolioAnalystImport(conversation, {
        draftId: body.draftId,
        targetLabel,
        submissionText: body.submissionText,
        screenshotCount: body.screenshotCount,
        createdAt: options.now?.() ?? new Date().toISOString(),
      });
      options.conversations?.savePortfolioAnalystConversation(nextConversation);
      return json({
        conversation: nextConversation,
        importDraft: createImportDraftReadModel(draft),
      });
    },

    async POST(
      request: Request,
      emit?: (event: PortfolioAnalystStreamEvent) => void,
    ) {
      let body: z.infer<typeof requestSchema>;
      try {
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
          return json(
            { error: "Analyst request is too large.", code: "request-too-large" },
            { status: 413 },
          );
        }
        body = requestSchema.parse(JSON.parse(text));
      } catch {
        return json(
          { error: "Analyst request is invalid.", code: "invalid-request" },
          { status: 400 },
        );
      }

      emit?.({
        type: "accepted",
        question: requestQuestion(body),
      });

      const provider = registry.providers[body.provider];
      if (!provider) {
        return json({
          error: `${providerNames[body.provider]} is not configured. Add its API key to .env.local.`,
          code: "provider-not-configured",
        }, { status: 503 });
      }
      const portfolio = options.readCurrentPortfolio();
      if (!portfolio) {
        return json(
          { error: "No current portfolio facts are available.", code: "portfolio-empty" },
          { status: 409 },
        );
      }

      const stored = body.conversationId
        ? options.conversations?.readPortfolioAnalystConversation(body.conversationId)
        : undefined;
      let conversation = stored && normalizePortfolioAnalystConversation(stored);
      if (body.conversationId && !conversation) {
        return json(
          { error: "Analyst conversation was not found.", code: "conversation-not-found" },
          { status: 404 },
        );
      }
      if (
        conversation &&
        (conversation.provider !== body.provider ||
          conversation.includeHoldingNames !== body.includeHoldingNames)
      ) {
        return json(
          {
            error: "Provider or holding-name privacy changed. Reset the conversation before continuing.",
            code: "conversation-settings-mismatch",
          },
          { status: 409 },
        );
      }
      const generatedAt = options.now?.() ?? new Date().toISOString();
      const createId = options.createId ?? randomUUID;
      conversation ??= createPortfolioAnalystConversation({
        id: createId(),
        provider: body.provider,
        language: body.language,
        includeHoldingNames: body.includeHoldingNames,
        now: generatedAt,
      });

      let context: PortfolioAnalystContextV1;
      let answer: PortfolioAnalystAnswer;
      let agentAudit: PortfolioAnalystAgentAudit | undefined;
      try {
        const tools = createPortfolioAnalystTools(
          portfolio,
          options.readSourceAccounts?.() ?? [],
        );
        const agentRuntime = registry.agentRuntimes?.[body.provider];
        if (agentRuntime) {
          emit?.({ type: "status", phase: "selecting-tool" });
          const result = await agentRuntime.runTurn({
            question: runtimeQuestion(body),
            history: createPortfolioAnalystHistory(conversation),
            tools,
            language: body.language,
            includeHoldingNames: body.includeHoldingNames,
            defaultPeriod: requestDefaultPeriod(body),
            signal: request.signal,
            onPhase: (phase) => emit?.({ type: "status", phase }),
            onToolActivity: (activity) => emit?.({ type: "tool-activity", activity }),
            onAnswerTextDelta: (delta) => emit?.({ type: "answer-delta", delta }),
          });
          context = result.context;
          answer = result.answer;
          agentAudit = result.audit;
        } else {
          emit?.({ type: "status", phase: "reading-current-facts" });
          context = "mode" in body || body.job === "explain-period-drivers"
            ? tools.readPeriodDrivers({
                period: requestDefaultPeriod(body),
                language: body.language,
                includeHoldingNames: body.includeHoldingNames,
              })
            : tools.readDataQuality({
                language: body.language,
                includeHoldingNames: body.includeHoldingNames,
              });
          emit?.({ type: "status", phase: "generating-answer" });
          answer = await (options.sessionFactory ?? piPortfolioAnalystSessionFactory)
            .create(provider)
            .runTurn({
              context,
              question: runtimeQuestion(body),
              history: createPortfolioAnalystHistory(conversation),
              signal: request.signal,
              onAnswerTextDelta: (delta) => emit?.({ type: "answer-delta", delta }),
            });
        }
      } catch (error) {
        if (error instanceof PortfolioAnalystContextError) {
          return json(
            { error: "Analyst context is too large.", code: "context-too-large" },
            { status: 422 },
          );
        }
        const code = error instanceof PortfolioAnalystProviderError
          ? error.code
          : "provider-unavailable";
        const message = error instanceof PortfolioAnalystProviderError
          ? error.message
          : `${providerNames[body.provider]} could not generate a portfolio analyst answer.`;
        return json({ error: message, code }, { status: 502 });
      }

      const result: PortfolioAnalystReport = {
        provider: provider.id,
        model: provider.model,
        generatedAt,
        contextVersion: context.version,
        job: context.job,
        language: context.language,
        scope: context.scope,
        factsAsOf: context.factsAsOf,
        answer,
        evidence: citedEvidence(context, answer),
        ...(agentAudit ? { agentAudit } : {}),
        disclaimer: "AI-generated factual explanation · Not investment advice",
      };
      const nextConversation = appendPortfolioAnalystTurn({ ...conversation, language: body.language }, {
        id: createId(),
        question: requestQuestion(body),
        createdAt: generatedAt,
        report: result,
      });
      options.conversations?.savePortfolioAnalystConversation(nextConversation);
      return json({
        result,
        ...("mode" in body || body.question || body.conversationId
          ? { conversation: nextConversation }
          : {}),
      });
    },

    async DELETE(request: Request) {
      let body: { conversationId: string };
      try {
        body = z.object({
          conversationId: z.string().trim().min(1).max(80),
        }).strict().parse(await request.json());
      } catch {
        return json(
          { error: "Conversation delete request is invalid.", code: "invalid-request" },
          { status: 400 },
        );
      }
      const conversation = options.conversations?.readPortfolioAnalystConversation(body.conversationId);
      options.conversations?.deletePortfolioAnalystConversation(body.conversationId);
      if (options.deleteImage && conversation) {
        await Promise.allSettled(conversation.turns.flatMap((turn) => turn.attachments ?? [])
          .map((attachment) => options.deleteImage!(attachment)));
      }
      return json({ deleted: true });
    },
  };
}

let productionHandlers: ReturnType<typeof createPortfolioAnalystHandlers> | undefined;

function getProductionHandlers() {
  if (!productionHandlers) {
    const database = getPortfolioDatabase();
    productionHandlers = createPortfolioAnalystHandlers(
      getPortfolioAnalystProviderRegistry(),
      {
        readCurrentPortfolio: () => readPortfolioOverviewIncludingEmpty(
          database,
          new Date().toISOString(),
        ),
        readSourceAccounts: () => database.readSourceAccounts(),
        conversations: database,
        deleteImage: (attachment) => createLocalPortfolioAnalystImageStore().delete(attachment),
        getImportDraft: (id) => database.getImportDraft(id),
        discardImportDraft: (id) => database.discardImportDraft(id),
      },
    );
  }
  return productionHandlers;
}

export async function GET() {
  return getProductionHandlers().GET();
}

export async function POST(request: Request) {
  const handlers = getProductionHandlers();
  if (request.headers.get("accept") !== portfolioAnalystStreamContentType) {
    return handlers.POST(request);
  }

  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      let open = true;
      const emit = (event: PortfolioAnalystStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      void handlers.POST(request, emit)
        .then(async (response) => {
          const body = await response.json() as {
            conversation?: ReturnType<
              PortfolioAnalystConversationStore["readLatestPortfolioAnalystConversation"]
            >;
            error?: string;
            code?: string;
          };
          if (response.ok && body.conversation) {
            emit({ type: "completed", conversation: body.conversation });
          } else {
            emit({
              type: "failed",
              error: body.error ?? "The analyst could not complete this job.",
              ...(body.code ? { code: body.code } : {}),
            });
          }
        })
        .catch(() => emit({
          type: "failed",
          error: "The analyst could not complete this job.",
        }))
        .finally(() => {
          if (!open) return;
          open = false;
          controller.close();
        });
    },
  }), {
    headers: {
      "content-type": `${portfolioAnalystStreamContentType}; charset=utf-8`,
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    },
  });
}

export async function DELETE(request: Request) {
  return getProductionHandlers().DELETE(request);
}

export async function PATCH(request: Request) {
  return getProductionHandlers().PATCH(request);
}
