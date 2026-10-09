import type { PortfolioWorkflowResult } from "@/application/portfolio-workflow-result";
import type { AgentSaleDraft } from "@/application/agent-sale-draft";
import type {
  PortfolioAnalystProviderId,
  PortfolioAnalystReport,
} from "@/application/portfolio-analyst-provider";
import type { PortfolioAnalystLanguage } from "@/application/portfolio-analyst-contract";
import {
  portfolioAnalystActionLabel,
  portfolioAnalystLimitationLabel,
} from "@/application/portfolio-analyst-presentation";

const MAX_MODEL_HISTORY_TURNS = 5;
const MAX_HISTORY_USER_CHARS = 600;
const MAX_HISTORY_ASSISTANT_CHARS = 1_400;

function boundedHistoryText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}…` : value;
}

export interface PortfolioAnalystImageAttachment {
  id: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  byteLength: number;
}

export interface PortfolioAnalystImageAnswer {
  status?: "pending" | "complete" | "failed";
  text: string;
  uncertainties: string[];
  provider: "openai";
  model: string;
  generatedAt: string;
  sourceTurnId?: string;
}

export interface PortfolioAnalystChatReply {
  assistantText: string;
  requestStatus?: "pending";
  failureCode?: string;
  failureDetail?: string;
  memoryProposal?: {
    content: string;
    status: "pending" | "saved" | "cancelled";
  };
  saleDraft?: AgentSaleDraft;
  workflowResult?: PortfolioWorkflowResult;
  workflowReplyAudit?: import("@/application/portfolio-analyst-agent").PortfolioAnalystAgentAudit;
  imageAction?: {
    sourceTurnId: string;
    stage: "intent" | "account";
    preferredAccountType?: string;
    accountId?: string;
    purpose?: "sale";
  };
}

interface PortfolioAnalystConversationTurnBase {
  id: string;
  question: string;
  userText?: string;
  attachments?: PortfolioAnalystImageAttachment[];
  createdAt: string;
}

export type PortfolioAnalystConversationTurn = PortfolioAnalystConversationTurnBase & (
  | { report: PortfolioAnalystReport; imageAnswer?: never; importImage?: never; chat?: never }
  | { report?: never; imageAnswer: PortfolioAnalystImageAnswer; importImage?: never; chat?: never }
  | { report?: never; imageAnswer?: never; importImage: { sourceTurnId: string }; chat?: never }
  | { report?: never; imageAnswer?: never; importImage?: never; chat: PortfolioAnalystChatReply }
);

export interface PortfolioAnalystImportActivity {
  draftId: string;
  sourceTurnId?: string;
  targetLabel: string;
  submissionText: string;
  screenshotCount: number;
  createdAt: string;
  cancelledAt?: string;
  followUps?: PortfolioAnalystImportFollowUp[];
}

export interface PortfolioAnalystImportFollowUp {
  id: string;
  userText: string;
  assistantText: string;
  createdAt: string;
}

export interface PortfolioAnalystConversation {
  version: "portfolio-analyst-conversation.v1";
  id: string;
  provider: PortfolioAnalystProviderId;
  language: PortfolioAnalystLanguage;
  includeHoldingNames: boolean;
  createdAt: string;
  updatedAt: string;
  turns: PortfolioAnalystConversationTurn[];
  importActivities: PortfolioAnalystImportActivity[];
}

export function normalizePortfolioAnalystConversation(
  conversation: PortfolioAnalystConversation,
): PortfolioAnalystConversation {
  const legacy = conversation as PortfolioAnalystConversation & {
    importActivity?: PortfolioAnalystImportActivity;
  };
  const { importActivity, ...current } = legacy;
  return {
    ...current,
    provider: "openai",
    includeHoldingNames: true,
    importActivities: conversation.importActivities ?? (importActivity ? [importActivity] : []),
  };
}

export function attachPortfolioAnalystImport(
  conversation: PortfolioAnalystConversation,
  activity: PortfolioAnalystImportActivity,
): PortfolioAnalystConversation {
  const current = normalizePortfolioAnalystConversation(conversation);
  const earlier = current.importActivities.find((item) => item.draftId === activity.draftId);
  return {
    ...current,
    updatedAt: activity.createdAt,
    importActivities: [
      ...current.importActivities.filter((item) => item.draftId !== activity.draftId),
      { ...activity, ...(earlier?.followUps?.length ? { followUps: earlier.followUps } : {}) },
    ],
  };
}

export function appendPortfolioAnalystImportFollowUp(
  conversation: PortfolioAnalystConversation,
  draftId: string,
  followUp: PortfolioAnalystImportFollowUp,
): PortfolioAnalystConversation {
  if (!conversation.importActivities.some((activity) => activity.draftId === draftId)) {
    throw new Error("The import draft is not part of this conversation.");
  }
  return {
    ...normalizePortfolioAnalystConversation(conversation),
    updatedAt: followUp.createdAt,
    importActivities: conversation.importActivities.map((activity) => activity.draftId === draftId
      ? { ...activity, followUps: activity.followUps?.some((item) => item.id === followUp.id)
        ? activity.followUps
        : [...(activity.followUps ?? []), followUp] }
      : activity),
  };
}

export function cancelPortfolioAnalystImport(
  conversation: PortfolioAnalystConversation,
  draftId: string,
  input: { id: string; userText: string; cancelledAt: string },
): PortfolioAnalystConversation {
  const current = normalizePortfolioAnalystConversation(conversation);
  if (!current.importActivities.some((activity) => activity.draftId === draftId)) {
    throw new Error("The import draft is not part of this conversation.");
  }
  const assistantText = current.language === "zh-CN"
    ? "已取消这次导入并删除未确认的草稿。你的持仓没有变化。"
    : "I cancelled this import and removed its unconfirmed draft. Your holdings were not changed.";
  return {
    ...current,
    updatedAt: input.cancelledAt,
    importActivities: current.importActivities.map((activity) => activity.draftId === draftId
      ? {
          ...activity,
          cancelledAt: input.cancelledAt,
          followUps: [...(activity.followUps ?? []), {
            id: input.id, userText: input.userText, assistantText, createdAt: input.cancelledAt,
          }],
        }
      : activity),
  };
}

export interface PortfolioAnalystConversationStore {
  readLatestPortfolioAnalystConversation(): PortfolioAnalystConversation | undefined;
  readPortfolioAnalystConversation(id: string): PortfolioAnalystConversation | undefined;
  savePortfolioAnalystConversation(conversation: PortfolioAnalystConversation): void;
  deletePortfolioAnalystConversation(id: string): void;
}

export type PortfolioAnalystHistoryMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; factsAsOf: string };

function historicalAssistantText(report: PortfolioAnalystReport): string {
  const language = report.language;
  return [
    report.answer.answer.text,
    ...report.answer.claims.map((claim) => claim.text),
    ...report.answer.limitations.map((limitation) =>
      `${language === "zh-CN" ? "限制" : "Limitation"}: ${portfolioAnalystLimitationLabel(limitation.code, language)}`
    ),
    ...(report.answer.proposedUpdate
      ? [
          `${language === "zh-CN" ? "建议但未执行" : "Suggested, not executed"}: ${portfolioAnalystActionLabel(report.answer.proposedUpdate, language)}`,
        ]
      : []),
  ].join("\n");
}

export function createPortfolioAnalystConversation(input: {
  id: string;
  provider: PortfolioAnalystProviderId;
  language: PortfolioAnalystLanguage;
  includeHoldingNames: boolean;
  now: string;
}): PortfolioAnalystConversation {
  return {
    version: "portfolio-analyst-conversation.v1",
    id: input.id,
    provider: input.provider,
    language: input.language,
    includeHoldingNames: input.includeHoldingNames,
    createdAt: input.now,
    updatedAt: input.now,
    turns: [],
    importActivities: [],
  };
}

export function appendPortfolioAnalystTurn(
  conversation: PortfolioAnalystConversation,
  turn: PortfolioAnalystConversationTurn,
): PortfolioAnalystConversation {
  return {
    ...normalizePortfolioAnalystConversation(conversation),
    updatedAt: turn.createdAt,
    turns: [...conversation.turns, turn],
  };
}

export function replacePortfolioAnalystTurn(
  conversation: PortfolioAnalystConversation,
  turn: PortfolioAnalystConversationTurn,
  now: string,
): PortfolioAnalystConversation {
  if (!conversation.turns.some((item) => item.id === turn.id)) {
    throw new Error("The conversation turn was not found.");
  }
  return {
    ...conversation,
    updatedAt: now,
    turns: conversation.turns.map((item) => item.id === turn.id ? turn : item),
  };
}

export function resolvePortfolioAnalystMemoryProposal(
  conversation: PortfolioAnalystConversation,
  turnId: string,
  status: "saved" | "cancelled",
  now: string,
): PortfolioAnalystConversation {
  const turn = conversation.turns.find((item) => item.id === turnId);
  if (!turn?.chat?.memoryProposal || turn.chat.memoryProposal.status !== "pending") {
    throw new Error("Pending memory proposal was not found.");
  }
  return {
    ...conversation,
    updatedAt: now,
    turns: conversation.turns.map((item) => item.id !== turnId || !item.chat ? item : {
      ...item,
      chat: {
        ...item.chat,
        memoryProposal: { ...item.chat.memoryProposal!, status },
      },
    }),
  };
}

export function appendPortfolioAnalystImportImageTurn(
  conversation: PortfolioAnalystConversation,
  input: {
    sourceTurnId: string;
    id: string;
    createdAt: string;
    userText: string;
    attachments: PortfolioAnalystImageAttachment[];
  },
): PortfolioAnalystConversation {
  const source = conversation.turns.find((item) => item.id === input.sourceTurnId);
  if (!source?.report || conversation.turns.some((item) => item.importImage?.sourceTurnId === input.sourceTurnId)) {
    throw new Error("The import message cannot accept images.");
  }
  return {
    ...normalizePortfolioAnalystConversation(conversation),
    updatedAt: input.createdAt,
    turns: [...conversation.turns, {
      id: input.id,
      question: input.userText,
      userText: input.userText,
      attachments: input.attachments,
      createdAt: input.createdAt,
      importImage: { sourceTurnId: input.sourceTurnId },
    }],
  };
}

export function createPortfolioAnalystHistory(
  conversation: PortfolioAnalystConversation,
): PortfolioAnalystHistoryMessage[] {
  const exchanges = conversation.turns.flatMap((turn) => {
    if (turn.chat?.memoryProposal?.status === "pending" || turn.chat?.failureCode || turn.chat?.requestStatus === "pending") return [];
    if (turn.importImage) return [];
    if (turn.imageAnswer && turn.imageAnswer.status && turn.imageAnswer.status !== "complete") return [];
    if (!conversation.includeHoldingNames && (turn.chat || turn.imageAnswer)) return [];
    const assistantText = turn.report
      ? historicalAssistantText(turn.report)
      : turn.imageAnswer?.text ?? turn.chat?.assistantText ?? "";
    if (!assistantText.trim()) return [];
    const memoryReview = turn.chat?.memoryProposal?.status;
    return [{
      createdAt: turn.createdAt,
      userText: turn.question.trim() || "Shared an image",
      assistantText: memoryReview === "saved" || memoryReview === "cancelled"
        ? `${assistantText}\nMemory review: ${memoryReview}.`
        : assistantText,
      factsAsOf: turn.report?.factsAsOf ?? turn.imageAnswer?.generatedAt ?? turn.createdAt,
    }];
  });
  if (conversation.includeHoldingNames) {
    for (const activity of conversation.importActivities) {
      for (const followUp of activity.followUps ?? []) {
        if (!followUp.userText.trim() || !followUp.assistantText.trim()) continue;
        exchanges.push({
          createdAt: followUp.createdAt,
          userText: followUp.userText,
          assistantText: followUp.assistantText,
          factsAsOf: followUp.createdAt,
        });
      }
    }
  }
  const recent = exchanges
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-MAX_MODEL_HISTORY_TURNS);
  const history: PortfolioAnalystHistoryMessage[] = recent.flatMap((exchange) => [
    { role: "user" as const, text: boundedHistoryText(exchange.userText, MAX_HISTORY_USER_CHARS) },
    { role: "assistant" as const, text: boundedHistoryText(exchange.assistantText, MAX_HISTORY_ASSISTANT_CHARS), factsAsOf: exchange.factsAsOf },
  ]);
  const recentImport = conversation.importActivities.at(-1);
  const latestExchangeAt = recent.at(-1)?.createdAt;
  if (
    conversation.includeHoldingNames &&
    recentImport &&
    !recentImport.followUps?.length &&
    (!latestExchangeAt || recentImport.createdAt > latestExchangeAt)
  ) {
    history.push({
      role: "assistant",
      text: `Recent local import activity targeted source account ${JSON.stringify(recentImport.targetLabel)}. This is reference metadata, not current holdings evidence.`,
      factsAsOf: recentImport.createdAt,
    });
  }
  return history;
}
