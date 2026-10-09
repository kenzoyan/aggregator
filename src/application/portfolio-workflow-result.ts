import type { SaleDraftFields } from "@/application/agent-sale-draft";

export interface PortfolioWorkflowResult {
  workflow: "sale";
  operation: "prepare" | "update" | "cancel" | "review" | "save";
  status: "succeeded" | "failed";
  recordedAt: string;
  portfolioChanged: boolean;
  code?: string;
  details?: string;
  draft?: SaleDraftFields;
  asset?: { name: string; accountName: string; currency: string };
  sale?: { date: string; quantity: string; netProceeds: string; realizedResult: string; destination: string; excludedFromTrackedAssets: boolean };
  warnings?: string[];
}
