import { portfolioAnalystHistory } from "@/server/portfolio-analyst-history";
import type { PortfolioFacts } from "@/infrastructure/sqlite/portfolio-repository-contract";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type { PortfolioAnalystAgentAudit, PortfolioAnalystDraftTools } from "@/application/portfolio-analyst-agent";
import { createPortfolioDraftTools } from "@/server/portfolio-draft-tools";
import { createImportWorkflowResult } from "@/application/imports/import-workflow-result";
import { completePortfolioWorkflowReply, type WorkflowReplyGenerator } from "@/application/portfolio-workflow-reply";
import { createPortfolioWorkflowReply } from "@/server/portfolio-workflow-reply";
import {
  attachPortfolioAnalystImport,
  appendPortfolioAnalystTurn,
  createPortfolioAnalystConversation,
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
  imageSourceTurnId: z.string().min(1).max(80).optional(),
  importDraftId: z.string().min(1).max(100).optional(),
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
    readActivityFacts?: () => PortfolioFacts;
    now?: () => string;
    createId?: () => string;
    conversations?: PortfolioAnalystConversationStore;
    memory?: PortfolioAnalystMemoryStore;
    readImage?: (attachment: PortfolioAnalystImageAttachment) => Promise<Uint8Array | undefined>;
    deleteImage?: (attachment: PortfolioAnalystImageAttachment) => Promise<void>;
    getImportDraft?: (id: string) => StoredImportDraft | undefined;
    createDraftTools?: (conversationId: string, userTurnId: string, imageSourceTurnId?: string, importDraftId?: string) => PortfolioAnalystDraftTools;
    workflowReply?: WorkflowReplyGenerator;
  },
) {
  const importDraftsFor = (conversation: ReturnType<PortfolioAnalystConversationStore["readPortfolioAnalystConversation"]>) =>
    conversation?.importActivities.flatMap((activity) => {
      const draft = options.getImportDraft?.(activity.draftId);
      return draft ? [createImportDraftReadModel(draft)] : [];
    }) ?? [];
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
      if (options.workflowReply && options.conversations && !nextConversation.turns.some((turn) =>
        turn.chat?.workflowResult?.operation === "prepare" && turn.chat.workflowResult.importDraft?.id === draft.id)) {
        const now = options.now?.() ?? new Date().toISOString();
        const turnId = (options.createId ?? randomUUID)();
        const next = appendPortfolioAnalystTurn(nextConversation, { id: turnId, question: "", createdAt: now,
          chat: { assistantText: "", requestStatus: "pending", workflowResult: createImportWorkflowResult({
            draft, accountName: targetLabel, operation: "prepare", status: "succeeded", recordedAt: now,
          }) } });
        options.conversations.savePortfolioAnalystConversation(next);
        const reply = await completePortfolioWorkflowReply({ conversations: options.conversations, conversation: next,
          turnId, generate: options.workflowReply, signal: request.signal });
        return json({ ...reply, importDraft: createImportDraftReadModel(draft) });
      }
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

      const imageSource = "mode" in body && body.imageSourceTurnId
        ? conversation.turns.find((turn) => turn.id === body.imageSourceTurnId) : undefined;
      if ("mode" in body && body.importDraftId && !conversation.importActivities.some((activity) => activity.draftId === body.importDraftId)) {
        return json({ error: "Import draft does not belong to this conversation.", code: "import-draft-not-found" }, { status: 404 });
      }
      const reuseImageTurn = imageSource?.id === conversation.turns.at(-1)?.id && Boolean(imageSource?.chat &&
        !imageSource.chat.assistantText && !imageSource.chat.workflowResult && (requestQuestion(body) === (imageSource.userText ?? imageSource.question) || !(imageSource.userText ?? imageSource.question)));
      const pendingTurnId = "mode" in body && options.conversations ? reuseImageTurn ? imageSource!.id : createId() : undefined;
      if ("mode" in body && body.imageSourceTurnId && !conversation.turns.some((turn) =>
        turn.id === body.imageSourceTurnId && turn.attachments?.length)) {
        return json({ error: "Saved image was not found in this conversation.", code: "image-not-found" }, { status: 404 });
      }
      if (pendingTurnId) {
        const pending = {
          id: pendingTurnId,
          question: requestQuestion(body),
          ...(reuseImageTurn ? { userText: imageSource!.userText, attachments: imageSource!.attachments } : {}),
          createdAt: generatedAt,
          chat: {
            assistantText: "",
            requestStatus: "pending" as const,
          },
        };
        conversation = reuseImageTurn
          ? replacePortfolioAnalystTurn({ ...conversation, language: body.language }, pending, generatedAt)
          : appendPortfolioAnalystTurn({ ...conversation, language: body.language }, pending);
        options.conversations!.savePortfolioAnalystConversation(conversation);
      }

      const finishTurn = (turn: Parameters<typeof appendPortfolioAnalystTurn>[1]) =>
        pendingTurnId
          ? replacePortfolioAnalystTurn(conversation, { ...turn, ...(reuseImageTurn ? { attachments: imageSource!.attachments, userText: imageSource!.userText, question: imageSource!.question } : {}) }, options.now?.() ?? new Date().toISOString())
          : appendPortfolioAnalystTurn({ ...conversation, language: body.language }, turn);

      let context: PortfolioAnalystContextV1;
      let answer: PortfolioAnalystAnswer;
      let agentAudit: PortfolioAnalystAgentAudit | undefined;
      const draftTools = pendingTurnId ? options.createDraftTools?.(conversation.id, pendingTurnId,
        "mode" in body ? body.imageSourceTurnId : undefined, "mode" in body ? body.importDraftId : undefined) : undefined;
      const finishDraftReply = (text?: string, audit?: PortfolioAnalystAgentAudit) => {
        const operationTurnId = draftTools?.resultTurnId?.();
        if (!operationTurnId || !options.conversations || !pendingTurnId) return undefined;
        const latest = options.conversations.readPortfolioAnalystConversation(conversation.id);
        const operation = latest?.turns.find((turn) => turn.id === operationTurnId);
        if (!latest || !operation?.chat?.workflowResult || options.conversations.readLatestPortfolioAnalystConversation()?.id !== latest.id) throw new Error("Draft operation result was not found.");
        const intermediateIds = new Set(draftTools?.resultTurnIds?.() ?? [operationTurnId]);
        const newDraft = latest.turns.findLast((turn) => intermediateIds.has(turn.id) && turn.chat?.saleDraft)?.chat?.saleDraft;
        const next = { ...latest, turns: latest.turns.filter((turn) => !intermediateIds.has(turn.id)).map((turn) =>
          turn.id === pendingTurnId && turn.chat ? { ...turn, chat: { ...operation.chat!,
            ...(newDraft ? { saleDraft: newDraft } : {}), assistantText: text ?? "",
            requestStatus: text ? undefined : "pending" as const, ...(audit ? { workflowReplyAudit: audit } : {}) } } : turn) };
        options.conversations.savePortfolioAnalystConversation(next);
        return next;
      };
      try {
        const tools = createPortfolioAnalystTools(
          portfolio,
          options.readSourceAccounts?.() ?? [],
          options.readActivityFacts?.(),
        );
        emit?.({ type: "status", phase: "selecting-tool" });
        const result = await agentRuntime.runTurn({
          question: requestQuestion(body) + (reuseImageTurn ? `\n[Attached image sourceTurnId=${imageSource!.id}; ${imageSource!.attachments!.map((a, index) => `Image ${conversation.turns.filter((t) => t.id !== imageSource!.id).reduce((n, t) => n + (t.attachments?.length ?? 0), 0) + index + 1}: ${a.id}`).join("; ")}]` : ""),
          history: await portfolioAnalystHistory(conversation, { read: options.readImage ?? (async () => undefined) }, pendingTurnId),
          ...(reuseImageTurn ? { images: await Promise.all((imageSource!.attachments ?? []).map(async (attachment) => {
            const bytes = await options.readImage?.(attachment);
            if (!bytes) throw new Error("Saved image is unavailable. Please attach it again.");
            return { data: Buffer.from(bytes).toString("base64"), mimeType: attachment.mimeType };
          })) } : {}),
          tools,
          language: body.language,
          includeHoldingNames: body.includeHoldingNames,
          defaultPeriod: requestDefaultPeriod(body),
          memories: options.memory?.listPortfolioAnalystMemories(),
          draftTools,
          hasPendingMemoryProposal: conversation.turns.some((turn) => turn.chat?.memoryProposal?.status === "pending"),
          factsAsOf: portfolio.insights.asOf,
          signal: request.signal,
          onPhase: (phase) => emit?.({ type: "status", phase }),
          onToolActivity: (activity) => emit?.({ type: "tool-activity", activity }),
          onAnswerTextDelta: (delta) => emit?.({ type: "answer-delta", delta }),
        });
        if (result.kind === "conversation") {
          const draftConversation = finishDraftReply(result.reply, result.audit);
          if (draftConversation) return json({ conversation: draftConversation, importDrafts: importDraftsFor(draftConversation) });
          const nextConversation = finishTurn({
            id: pendingTurnId ?? createId(),
            question: requestQuestion(body),
            createdAt: generatedAt,
            chat: {
              assistantText: result.reply,
              workflowReplyAudit: result.audit,
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
          // Draft changes are already persisted. A failed reply must not overwrite or repeat them.
          if (draftTools?.resultTurnId?.()) {
            const latest = finishDraftReply();
            return json({ conversation: latest, importDrafts: importDraftsFor(latest), replyUnavailable: true, replyTurnId: pendingTurnId });
          }
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
        readActivityFacts: () => database.readPortfolioFacts(),
        conversations: database,
        memory: database,
        readImage: (attachment) => createLocalPortfolioAnalystImageStore().read(attachment),
        deleteImage: (attachment) => createLocalPortfolioAnalystImageStore().delete(attachment),
        getImportDraft: (id) => database.getImportDraft(id),
        createDraftTools: (conversationId, turnId, imageSourceTurnId, importDraftId) => createPortfolioDraftTools(database, conversationId, turnId, imageSourceTurnId, undefined, importDraftId),
        workflowReply: createPortfolioWorkflowReply(database),
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
            importDrafts?: ReturnType<typeof createImportDraftReadModel>[];
          };
          if (response.ok && body.conversation) {
            emit({ type: "completed", conversation: body.conversation, ...(body.importDrafts ? { importDrafts: body.importDrafts } : {}) });
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
