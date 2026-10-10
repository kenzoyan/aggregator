import type { StoredImportDraft } from "@/domain/imports";
import type { PortfolioWorkflowResult } from "@/application/portfolio-workflow-result";
import { createImportDraftReadModel } from "./import-draft-read-model";
import { nextImportDateFollowUp } from "./import-chat-follow-up";

export function createImportWorkflowResult(input: {
  draft: StoredImportDraft; accountName: string; operation: PortfolioWorkflowResult["operation"];
  status: "succeeded" | "failed"; recordedAt: string; portfolioChanged?: boolean;
  cancelled?: boolean; details?: string; code?: string;
}): PortfolioWorkflowResult {
  const model = createImportDraftReadModel(input.draft);
  return {
    workflow: "import", operation: input.operation, status: input.status,
    recordedAt: input.recordedAt, portfolioChanged: input.portfolioChanged ?? false,
    details: input.details, code: input.code, warnings: model.warnings,
    importDraft: {
      id: model.id, accountName: input.accountName, status: input.cancelled ? "cancelled" : model.status,
      asOf: model.portfolio.asOf, holdingCount: model.portfolio.holdings.length,
      holdings: model.portfolio.holdings.map((holding) => ({
        lineId: holding.lineId, name: holding.displayName || holding.instrumentId, code: holding.instrumentCode, priceAsOf: holding.priceAsOf,
        quantity: holding.quantity, costBasis: holding.costBasis, currency: holding.currency, observedPrice: holding.observedPrice,
      })),
      ...(!input.cancelled && model.status === "draft" ? { nextRequiredDate: nextImportDateFollowUp(model) } : {}),
    },
  };
}
