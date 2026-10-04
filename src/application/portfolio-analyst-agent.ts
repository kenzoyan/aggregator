import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type {
  PortfolioAnalystContextV1,
  PortfolioAnalystLanguage,
  PortfolioAnalystTools,
} from "@/application/portfolio-analyst-contract";
import type { PortfolioAnalystHistoryMessage } from "@/application/portfolio-analyst-conversation";
import type { Period } from "@/application/portfolio-read-model";

export const portfolioAnalystToolNames = [
  "read_period_drivers",
  "read_data_quality",
  "read_portfolio_overview",
  "read_accounts",
  "read_account_holdings",
  "propose_create_account",
  "prepare_account_import",
  "search_web",
] as const;

export type PortfolioAnalystToolName = typeof portfolioAnalystToolNames[number];

export interface PortfolioAnalystToolAudit {
  toolCallId: string;
  name: PortfolioAnalystToolName;
  input: { period?: Period; accountType?: string; label?: string; query?: string };
  status: "completed" | "blocked" | "failed";
  factsAsOf?: string;
  evidenceKeys: string[];
  errorCode?: "tool-budget-exceeded" | "tool-execution-failed";
}

export interface PortfolioAnalystAgentAudit {
  runtime: "pi-agent-core";
  modelTurns: number;
  stopReason: "completed";
  toolCalls: PortfolioAnalystToolAudit[];
}

export type PortfolioAnalystToolActivity =
  | {
      stage: "started";
      toolCallId: string;
      name: PortfolioAnalystToolName;
      input: PortfolioAnalystToolAudit["input"];
    }
  | {
      stage: "completed";
      toolCallId: string;
      name: PortfolioAnalystToolName;
      input: PortfolioAnalystToolAudit["input"];
      factsAsOf: string;
      evidenceCount: number;
    };

export interface PortfolioAnalystAgentTurn {
  question: string;
  history: PortfolioAnalystHistoryMessage[];
  tools: PortfolioAnalystTools;
  language: PortfolioAnalystLanguage;
  includeHoldingNames: boolean;
  defaultPeriod: Period;
  factsAsOf?: string;
  signal?: AbortSignal;
  onPhase?: (phase: "reading-current-facts" | "generating-answer") => void;
  onToolActivity?: (activity: PortfolioAnalystToolActivity) => void;
  onAnswerTextDelta?: (delta: string) => void;
}

export type PortfolioAnalystAgentResult =
  | {
      kind: "report";
      answer: PortfolioAnalystAnswer;
      context: PortfolioAnalystContextV1;
      audit: PortfolioAnalystAgentAudit;
    }
  | {
      kind: "conversation";
      reply: string;
      audit: PortfolioAnalystAgentAudit;
    };

export interface PortfolioAnalystAgentRuntime {
  runTurn(input: PortfolioAnalystAgentTurn): Promise<PortfolioAnalystAgentResult>;
}
