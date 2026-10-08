import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type { PortfolioAnalystAgentAudit } from "@/application/portfolio-analyst-agent";
import {
  attachPortfolioAnalystImport,
  appendPortfolioAnalystTurn,
  createPortfolioAnalystConversation,
  createPortfolioAnalystHistory,
  normalizePortfolioAnalystConversation,
  replacePortfolioAnalystTurn,
  type PortfolioAnalystImageAttachment,
  type PortfolioAnalystConversationStore,
} from "@/application/portfolio-analyst-conversation";
import {
  createImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
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
import type { SourceAccountDefinition } from "@/domain/source-accounts";
import type { StoredImportDraft } from "@/domain/imports";
import type { PortfolioAnalystMemoryStore } from "@/application/portfolio-analyst-memory";
import {
  portfolioAnalystStreamContentType,
  type PortfolioAnalystStreamEvent,
} from "@/application/portfolio-analyst-stream";
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
  includeHoldingNames: z.boolean().optional().transform(() => true),
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
type AnalystApiRequest = z.infer<typeof requestSchema>;

const providerNames = { openai: "OpenAI" } as const;

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
    memory?: PortfolioAnalystMemoryStore;
    deleteImage?: (attachment: PortfolioAnalystImageAttachment) => Promise<void>;
    getImportDraft?: (id: string) => StoredImportDraft | undefined;
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
          configured: Boolean(registry.agentRuntimes[id]),
          model: registry.models[id],
        })),
        ...(conversation ? { conversation } : {}),
        ...(importDrafts.length ? { importDrafts } : {}),
      });
    },

    async PATCH(request: Request) {
      let body: z.infer<typeof importActivitySchema>;
      try {
        body = importActivitySchema.parse(await request.json());
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

      const agentRuntime = registry.agentRuntimes[body.provider];
      if (!agentRuntime) {
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
      const generatedAt = options.now?.() ?? new Date().toISOString();
      const createId = options.createId ?? randomUUID;
      conversation ??= createPortfolioAnalystConversation({
        id: createId(),
        provider: body.provider,
        language: body.language,
        includeHoldingNames: body.includeHoldingNames,
        now: generatedAt,
      });

      const pendingTurnId = "mode" in body && options.conversations ? createId() : undefined;
      if (pendingTurnId) {
        conversation = appendPortfolioAnalystTurn({ ...conversation, language: body.language }, {
          id: pendingTurnId,
          question: requestQuestion(body),
          createdAt: generatedAt,
          chat: {
            assistantText: body.language === "zh-CN"
              ? "正在生成回答。如果请求中断，请重新发送问题。"
              : "Response in progress. If the request is interrupted, send the question again.",
            requestStatus: "pending",
          },
        });
        options.conversations!.savePortfolioAnalystConversation(conversation);
      }

      const finishTurn = (turn: Parameters<typeof appendPortfolioAnalystTurn>[1]) =>
        pendingTurnId
          ? replacePortfolioAnalystTurn(conversation, turn, options.now?.() ?? new Date().toISOString())
          : appendPortfolioAnalystTurn({ ...conversation, language: body.language }, turn);

      let context: PortfolioAnalystContextV1;
      let answer: PortfolioAnalystAnswer;
      let agentAudit: PortfolioAnalystAgentAudit | undefined;
      try {
        const tools = createPortfolioAnalystTools(
          portfolio,
          options.readSourceAccounts?.() ?? [],
        );
        emit?.({ type: "status", phase: "selecting-tool" });
        const result = await agentRuntime.runTurn({
          question: runtimeQuestion(body),
          history: createPortfolioAnalystHistory(conversation),
          tools,
          language: body.language,
          includeHoldingNames: body.includeHoldingNames,
          defaultPeriod: requestDefaultPeriod(body),
          memories: options.memory?.listPortfolioAnalystMemories(),
          hasPendingMemoryProposal: conversation.turns.some((turn) => turn.chat?.memoryProposal?.status === "pending"),
          factsAsOf: portfolio.insights.asOf,
          signal: request.signal,
          onPhase: (phase) => emit?.({ type: "status", phase }),
          onToolActivity: (activity) => emit?.({ type: "tool-activity", activity }),
          onAnswerTextDelta: (delta) => emit?.({ type: "answer-delta", delta }),
        });
        if (result.kind === "conversation") {
          const nextConversation = finishTurn({
            id: pendingTurnId ?? createId(),
            question: requestQuestion(body),
            createdAt: generatedAt,
            chat: {
              assistantText: result.reply,
              ...(result.memoryProposal ? {
                memoryProposal: { content: result.memoryProposal.content, status: "pending" as const },
              } : {}),
            },
          });
          options.conversations?.savePortfolioAnalystConversation(nextConversation);
          return json({ conversation: nextConversation });
        }
        context = result.context;
        answer = result.answer;
        agentAudit = result.audit;
      } catch (error) {
        if ("mode" in body && options.conversations) {
          const code = error instanceof PortfolioAnalystContextError
            ? "context-too-large"
            : error instanceof PortfolioAnalystProviderError ? error.code : "provider-unavailable";
          const detail = error instanceof PortfolioAnalystProviderError ? error.diagnosticCode : undefined;
          const assistantText = code === "invalid-provider-output"
            ? (body.language === "zh-CN"
              ? "我无法核实刚才生成的回答。这条消息已保留；请重试。"
              : "I couldn't verify the generated answer. This message is saved; please try again.")
            : detail === "timeout"
              ? (body.language === "zh-CN" ? "模型响应超时。这条消息已保留；请重试。" : "The model timed out. This message is saved; please try again.")
            : detail === "rate-limited"
              ? (body.language === "zh-CN" ? "模型请求暂时受限。这条消息已保留；请稍后重试。" : "The model is temporarily rate limited. This message is saved; please try again later.")
            : detail === "authentication" || detail === "request-rejected"
              ? (body.language === "zh-CN" ? "模型拒绝了这次请求。请检查模型配置；消息已保留。" : "The model rejected this request. Check its configuration; your message is saved.")
            : (body.language === "zh-CN"
              ? "这次回答没有完成。这条消息已保留；请稍后重试。"
              : "I couldn't complete the answer. This message is saved; please try again.");
          const nextConversation = finishTurn({
            id: pendingTurnId ?? createId(), question: body.question, createdAt: generatedAt,
            chat: {
              assistantText, failureCode: code,
              ...(error instanceof PortfolioAnalystProviderError && error.diagnosticCode
                ? { failureDetail: error.diagnosticCode } : {}),
            },
          });
          options.conversations.savePortfolioAnalystConversation(nextConversation);
          return json({ conversation: nextConversation });
        }
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
        provider: body.provider,
        model: registry.models[body.provider],
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
      const nextConversation = finishTurn({
        id: pendingTurnId ?? createId(),
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
        memory: database,
        deleteImage: (attachment) => createLocalPortfolioAnalystImageStore().delete(attachment),
        getImportDraft: (id) => database.getImportDraft(id),
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
