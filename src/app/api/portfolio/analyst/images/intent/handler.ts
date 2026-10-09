import { randomUUID } from "node:crypto";

import { z } from "zod";

import { resumableImageContext, type AgentImageIntentDecision, type AgentImageIntentInput } from "@/application/agent-image-intent";
import {
  appendPortfolioAnalystTurn,
  type PortfolioAnalystConversation,
  type PortfolioAnalystConversationStore,
  type PortfolioAnalystConversationTurn,
} from "@/application/portfolio-analyst-conversation";
import { normalizeSourceAccountType, type SourceAccountDefinition } from "@/domain/source-accounts";

const requestSchema = z.object({
  conversationId: z.string().min(1).max(80),
  sourceTurnId: z.string().min(1).max(80),
  id: z.uuid().optional(),
  text: z.string().trim().min(1).max(600).optional(),
}).strict().refine((value) => Boolean(value.id) === Boolean(value.text));

type Outcome = "clarify" | "answer-image" | "prepare-import" | "prepare-sale";

function reply(language: PortfolioAnalystConversation["language"], kind: "intent" | "account" | "missing" | "import", accounts: SourceAccountDefinition[], label?: string) {
  const zh = language === "zh-CN";
  if (kind === "intent") return zh
    ? "我收到了图片。你希望我解释图片内容，还是根据图片准备一份导入草稿供你审核？"
    : "I received your image. Would you like me to explain it or prepare an import draft for review?";
  if (kind === "missing") return zh
    ? "目前没有可接收截图的账户。请先在账户页添加账户，再告诉我继续处理这张图片。"
    : "There is no screenshot account yet. Add one on the Accounts page, then tell me to continue with this image.";
  if (kind === "account") return zh
    ? `这张图片属于哪个账户？请回复账户名称：${accounts.map((account) => account.label).join("、")}。`
    : `Which account is this image for? Reply with an account name: ${accounts.map((account) => account.label).join(", ")}.`;
  return zh
    ? `我会用「${label}」准备导入草稿，完成后请先审核并确认。`
    : `I'll prepare an import draft for ${label}. Please review and confirm it before anything changes.`;
}

export function createAgentImageIntentHandler(input: {
  conversations: PortfolioAnalystConversationStore;
  readAccounts: () => SourceAccountDefinition[];
  interpret: (value: AgentImageIntentInput & { signal: AbortSignal }) => Promise<AgentImageIntentDecision>;
  imageModel: string;
  now?: () => string;
  createId?: () => string;
}) {
  return async (request: Request) => {
    let body: z.infer<typeof requestSchema>;
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > 8 * 1024) {
        return Response.json({ error: "Image request is too large." }, { status: 413 });
      }
      body = requestSchema.parse(JSON.parse(raw));
    } catch {
      return Response.json({ error: "Image request is invalid." }, { status: 400 });
    }

    const conversation = input.conversations.readPortfolioAnalystConversation(body.conversationId);
    if (!conversation || input.conversations.readLatestPortfolioAnalystConversation()?.id !== conversation.id) {
      return Response.json({ error: "Current conversation was not found." }, { status: 404 });
    }
    const source = conversation.turns.find((turn) => turn.id === body.sourceTurnId);
    const latest = conversation.turns.at(-1);
    const action = latest?.chat?.imageAction;
    const resumable = action ? undefined : resumableImageContext(conversation);
    if (!source?.attachments?.length || (action?.sourceTurnId !== source.id && resumable?.sourceTurnId !== source.id)) {
      return Response.json({ error: "This image is no longer awaiting a reply." }, { status: 409 });
    }
    if (!body.id && !action) {
      return Response.json({ error: "A follow-up message is required." }, { status: 400 });
    }
    if (conversation.importActivities.some((activity) => activity.createdAt >= source.createdAt)) {
      return Response.json({ error: "This image already has an import activity." }, { status: 409 });
    }
    if (body.id && conversation.turns.some((turn) => turn.id === body.id)) {
      return Response.json({ error: "This reply was already sent." }, { status: 409 });
    }
    const text = body.text ?? source.userText ?? "";
    const accounts = input.readAccounts().filter((account) => account.updateMethod === "screenshot");
    const stage = action?.stage ?? resumable!.stage;
    const preferredAccountType = action?.preferredAccountType ?? resumable?.preferredAccountType;
    const salePurpose = action?.purpose === "sale";
    const exactAccount = stage === "account"
      ? accounts.find((candidate) => {
          const normalized = normalizeSourceAccountType(text);
          return normalized === normalizeSourceAccountType(candidate.label)
            || normalized === candidate.normalizedAccountType;
        })
      : undefined;
    let decision: AgentImageIntentDecision;
    try {
      decision = salePurpose && !body.id
        ? { intent: "prepare-sale", confidence: "high" }
        : exactAccount
        ? { intent: salePurpose ? "prepare-sale" : "prepare-import", confidence: "high", accountId: exactAccount.id }
        : stage === "import-follow-up" && /^(好的|好|可以|确认|继续|yes|ok|okay|go ahead)[.!。！\s]*$/iu.test(text)
        ? { intent: "prepare-import", confidence: "high", accountId: null }
        : !text
        ? { intent: preferredAccountType ? "prepare-import" : "answer-image", confidence: "high" }
        : await input.interpret({
          text,
          importFlowActive: stage === "account" || stage === "import-follow-up" || Boolean(preferredAccountType),
          stage,
          preferredAccountType,
          accounts: accounts.map(({ id, label, accountType }) => ({ id, label, accountType })),
          signal: request.signal,
        });
    } catch {
      return Response.json({ error: "I couldn't read that request. Please retry the response." }, { status: 502 });
    }
    if (body.id && decision.confidence === "high" && decision.intent === "delegate") {
      return Response.json({ conversation, intent: "delegate", sourceTurnId: source.id }, {
        headers: { "cache-control": "no-store" },
      });
    }

    let outcome: Outcome = decision.confidence === "high" && decision.intent !== "delegate"
      ? decision.intent : "clarify";
    let account = outcome === "prepare-import" && decision.accountId
      ? accounts.find((candidate) => candidate.id === decision.accountId)
      : undefined;
    if (outcome === "prepare-import" && !account && preferredAccountType) {
      const wanted = normalizeSourceAccountType(preferredAccountType);
      account = accounts.find((candidate) => candidate.normalizedAccountType === wanted);
    }
    if (outcome === "prepare-import" && !account && action?.accountId) {
      account = accounts.find((candidate) => candidate.id === action.accountId);
    }
    if (outcome === "prepare-import" && !account && accounts.length === 1) account = accounts[0];

    const now = (input.now ?? (() => new Date().toISOString()))();
    let assistantText = "";
    let nextStage: "intent" | "account" | undefined;
    if (outcome === "prepare-sale") {
      assistantText = "";
      nextStage = "intent";
    } else if (outcome === "clarify") {
      assistantText = reply(conversation.language, "intent", accounts);
      nextStage = "intent";
    } else if (outcome === "prepare-import" && !account) {
      assistantText = reply(conversation.language, accounts.length ? "account" : "missing", accounts);
      nextStage = "account";
      outcome = "clarify";
    } else if (outcome === "prepare-import") {
      assistantText = reply(conversation.language, "import", accounts, account?.label);
      nextStage = "account";
    }

    let next: PortfolioAnalystConversation;
    let answerTurnId: string | undefined;
    if (outcome === "answer-image") {
      const answer = {
        status: "pending" as const,
        text: "",
        uncertainties: [],
        provider: "openai" as const,
        model: input.imageModel,
        generatedAt: now,
        ...(body.id ? { sourceTurnId: source.id } : {}),
      };
      if (body.id) {
        answerTurnId = body.id;
        next = appendPortfolioAnalystTurn(conversation, {
          id: body.id, question: text, userText: text, createdAt: now, imageAnswer: answer,
        });
      } else {
        answerTurnId = source.id;
        next = {
          ...conversation, updatedAt: now,
          turns: conversation.turns.map((turn): PortfolioAnalystConversationTurn => {
            if (turn.id !== source.id) return turn;
            return {
              id: turn.id, question: turn.question, userText: turn.userText,
              attachments: turn.attachments, createdAt: turn.createdAt,
              imageAnswer: answer,
            };
          }),
        };
      }
    } else if (body.id) {
      next = appendPortfolioAnalystTurn(conversation, {
        id: body.id, question: text, userText: text, createdAt: now,
        chat: {
          assistantText,
          ...(nextStage ? { imageAction: {
            sourceTurnId: source.id, stage: nextStage,
            ...(outcome === "prepare-sale" ? { purpose: "sale" as const } : {}),
            ...(preferredAccountType ? { preferredAccountType } : {}),
            ...(account ? { accountId: account.id } : {}),
          } } : {}),
        },
      });
    } else {
      next = {
        ...conversation, updatedAt: now,
        turns: conversation.turns.map((turn) => turn.id === source.id && turn.chat
          ? { ...turn, chat: {
              assistantText,
              ...(nextStage ? { imageAction: {
                sourceTurnId: source.id, stage: nextStage,
                ...(outcome === "prepare-sale" ? { purpose: "sale" as const } : {}),
                ...(preferredAccountType ? { preferredAccountType } : {}),
                ...(account ? { accountId: account.id } : {}),
              } } : {}),
            } }
          : turn),
      };
    }
    input.conversations.savePortfolioAnalystConversation(next);
    return Response.json({
      conversation: next, intent: outcome,
      ...(account && outcome === "prepare-import" ? { accountId: account.id } : {}),
      ...(answerTurnId ? { answerTurnId } : {}),
      sourceTurnId: source.id,
    }, { headers: { "cache-control": "no-store" } });
  };
}
