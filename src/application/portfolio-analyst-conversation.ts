import type {
  PortfolioAnalystProviderId,
  PortfolioAnalystReport,
} from "@/application/portfolio-analyst-provider";
import type { PortfolioAnalystLanguage } from "@/application/portfolio-analyst-contract";
import {
  portfolioAnalystActionLabel,
  portfolioAnalystLimitationLabel,
} from "@/application/portfolio-analyst-presentation";

export const MAX_PORTFOLIO_ANALYST_TURNS = 12;
const MAX_MODEL_HISTORY_TURNS = 3;

export interface PortfolioAnalystConversationTurn {
  id: string;
  question: string;
  createdAt: string;
  report: PortfolioAnalystReport;
}

export interface PortfolioAnalystImportActivity {
  draftId: string;
  targetLabel: string;
  submissionText: string;
  screenshotCount: number;
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
  importActivity?: PortfolioAnalystImportActivity;
}

export function attachPortfolioAnalystImport(
  conversation: PortfolioAnalystConversation,
  activity: PortfolioAnalystImportActivity,
): PortfolioAnalystConversation {
  return {
    ...conversation,
    updatedAt: activity.createdAt,
    importActivity: activity,
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
  };
}

export function appendPortfolioAnalystTurn(
  conversation: PortfolioAnalystConversation,
  turn: PortfolioAnalystConversationTurn,
): PortfolioAnalystConversation {
  return {
    ...conversation,
    updatedAt: turn.createdAt,
    turns: [...conversation.turns, turn].slice(-MAX_PORTFOLIO_ANALYST_TURNS),
  };
}

export function createPortfolioAnalystHistory(
  conversation: PortfolioAnalystConversation,
): PortfolioAnalystHistoryMessage[] {
  return conversation.turns.slice(-MAX_MODEL_HISTORY_TURNS).flatMap((turn) => [
    { role: "user" as const, text: turn.question },
    {
      role: "assistant" as const,
      text: historicalAssistantText(turn.report),
      factsAsOf: turn.report.factsAsOf,
    },
  ]);
}
