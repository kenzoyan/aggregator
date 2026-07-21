import { describe, expect, it } from "vitest";

import {
  applyImportDraftReview,
  createImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
import { prepareScreenshotImport } from "@/application/imports/vision-extractor";

describe("Import Draft read model", () => {
  it("preserves inferred evidence until the user changes that field", () => {
    const draft = prepareScreenshotImport({
      draftId: "draft-1",
      snapshotId: "snapshot-1",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-21T10:00:00.000Z",
      extraction: {
        accountName: "Synthetic Provider",
        asOf: "2026-07-20T00:00:00.000Z",
        currency: "CNY",
        totalValue: "125",
        reportedPriorReturn: "25",
        confidence: "high",
        warnings: [],
        positions: [{
          displayName: "Synthetic Fund",
          instrumentCode: "001234",
          quantity: "10",
          currency: "CNY",
          marketValue: "125",
          costBasis: null,
          reportedPriorReturn: "25",
          reportedPriorReturnPercent: "25",
          confidence: "high",
        }],
      },
    });
    const readModel = createImportDraftReadModel({ ...draft, status: "draft" });

    expect(readModel.portfolio.holdings[0]?.assetType).toBeUndefined();
    const unknownTypeReview = applyImportDraftReview(draft, {
      confidence: readModel.confidence,
      warnings: readModel.warnings,
      portfolio: readModel.portfolio,
    });
    expect(unknownTypeReview.portfolio.holdings[0]?.assetType).toEqual({
      status: "unknown",
    });

    const unchanged = applyImportDraftReview(draft, {
      confidence: readModel.confidence,
      warnings: readModel.warnings,
      portfolio: readModel.portfolio,
    });
    expect(unchanged.portfolio.holdings[0]?.costBasis).toMatchObject({
      status: "inferred",
      value: "100",
    });

    readModel.portfolio.holdings[0]!.costBasis = "101";
    const edited = applyImportDraftReview(draft, {
      confidence: readModel.confidence,
      warnings: readModel.warnings,
      portfolio: readModel.portfolio,
    });
    expect(edited.portfolio.holdings[0]?.costBasis).toEqual({
      status: "known",
      value: "101",
      source: "manual",
    });
  });
});
