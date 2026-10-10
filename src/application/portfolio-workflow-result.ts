import type { SaleDraftFields } from "@/application/agent-sale-draft";

export interface PortfolioWorkflowResult {
  workflow: "sale" | "import" | "image";
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
  imageIntent?: { nextStep: "choose-intent" | "choose-account" | "create-account"; accounts: { id: string; name: string }[] };
  preview?: { netProceeds: string; realizedResult: string; quantity: string; estimatedQuantity: boolean; possibleDuplicate: boolean };
  importDraft?: { id: string; accountName: string; status: string; asOf: string;
    holdings: { lineId?: string; name: string; code?: string; priceAsOf?: string; quantity?: string; costBasis?: string; currency?: string; observedPrice?: string }[]; holdingCount: number;
    nextRequiredDate?: import("@/application/imports/import-chat-follow-up").ImportDateFollowUp };
}
