import type { PortfolioWorkflowResult } from "@/application/portfolio-workflow-result";
import type { PortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type {
  PortfolioAnalystContextV1,
  PortfolioAnalystLanguage,
  PortfolioAnalystTools,
} from "@/application/portfolio-analyst-contract";
import type { PortfolioAnalystHistoryMessage } from "@/application/portfolio-analyst-conversation";
import type { PortfolioAnalystMemory } from "@/application/portfolio-analyst-memory";
import type { Period } from "@/application/portfolio-read-model";

export const portfolioAnalystToolNames = [
  "read_period_drivers",
  "read_data_quality",
  "read_portfolio_overview",
  "read_all_holdings",
  "read_accounts",
  "read_account_holdings",
  "read_holding_history",
  "read_account_activity",
  "propose_create_account",
  "prepare_account_import",
  "search_web",
  "read_workflow_result",
  "read_image",
  "read_sale_draft",
  "prepare_sale_draft",
  "update_sale_draft",
  "cancel_sale_draft",
  "review_sale_draft",
  "prepare_import_draft",
  "read_import_draft",
  "update_import_draft",
  "cancel_import_draft",
  "review_import_draft",
  "read_memories",
  "propose_memory",
] as const;

export type PortfolioAnalystToolName = typeof portfolioAnalystToolNames[number];
export type SaleDraftToolName = "read_sale_draft" | "prepare_sale_draft" | "update_sale_draft" | "cancel_sale_draft" | "review_sale_draft";
export type PortfolioAnalystDraftToolName = SaleDraftToolName | "prepare_import_draft" | "read_import_draft" | "update_import_draft" | "cancel_import_draft" | "review_import_draft";
export interface PortfolioAnalystDraftArguments {
  sourceTurnId?: string;
  imageIds?: string[];
  accountId?: string;
  sale?: import("@/application/agent-sale-draft").SaleScreenshot;
  fields?: import("@/application/agent-sale-draft").SaleDraftFields;
  importEdit?: { field: "valuation-date" | "price-date" | "instrument-code" | "quantity" | "costBasis" | "displayName" | "currency" | "observedPrice" | "reportedPriorReturn" | "reportedMarketValue" | "averageCost"; value: string; holdingLineId?: string };
  holdings?: import("@/application/imports/vision-extraction-contract").ScreenshotExtraction;
}
export interface PortfolioAnalystDraftTools {
  execute(name: PortfolioAnalystDraftToolName, signal?: AbortSignal, args?: PortfolioAnalystDraftArguments): Promise<PortfolioWorkflowResult>;
  pending?: { sale: boolean; importAccount?: string; hasImage?: boolean };
  resultTurnId?: () => string | undefined;
  resultTurnIds?: () => readonly string[];
}

export type PortfolioAnalystToolFailureCode =
  | "tool-execution-failed"
  | "tool-timeout"
  | "tool-rate-limited"
  | "tool-authentication"
  | "tool-request-rejected"
  | "tool-network-failed";

export interface PortfolioAnalystToolAudit {
  toolCallId: string;
  name: PortfolioAnalystToolName;
  input: { period?: Period; accountType?: string; holding?: string; fromDate?: string; toDate?: string; label?: string; query?: string };
  status: "completed" | "blocked" | "failed";
  factsAsOf?: string;
  evidenceKeys: string[];
  memoryCount?: number;
  errorCode?: "tool-budget-exceeded" | PortfolioAnalystToolFailureCode;
  sourceUrls?: string[];
  researchStatus?: "completed" | "unavailable" | "no-verified-source";
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
      factsAsOf?: string;
      evidenceCount: number;
      memoryCount?: number;
      sourceUrls?: string[];
      researchStatus?: PortfolioAnalystToolAudit["researchStatus"];
    }
  | {
      stage: "failed";
      toolCallId: string;
      name: PortfolioAnalystToolName;
      input: PortfolioAnalystToolAudit["input"];
      errorCode: PortfolioAnalystToolFailureCode;
    };

export interface PortfolioAnalystAgentTurn {
  question: string;
  images?: { data: string; mimeType: string }[];
  history: PortfolioAnalystHistoryMessage[];
  tools: PortfolioAnalystTools;
  language: PortfolioAnalystLanguage;
  includeHoldingNames: boolean;
  defaultPeriod: Period;
  memories?: readonly PortfolioAnalystMemory[];
  hasPendingMemoryProposal?: boolean;
  factsAsOf?: string;
  workflowResult?: PortfolioWorkflowResult;
  imageAnalysis?: { read: () => Promise<{ answer: string; uncertainties: string[] }> };
  draftTools?: PortfolioAnalystDraftTools;
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
      memoryProposal?: { content: string };
      audit: PortfolioAnalystAgentAudit;
    };

export interface PortfolioAnalystAgentRuntime {
  runTurn(input: PortfolioAnalystAgentTurn): Promise<PortfolioAnalystAgentResult>;
}
