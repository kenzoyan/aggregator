import { describe, expect, it } from "vitest";

import {
  applyImportDraftReview,
  createImportDraftConfirmationPayload,
  createImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
import { prepareScreenshotImport } from "@/application/imports/vision-extractor";

describe("Import Draft read model", () => {
  it("projects only the editable review fields for confirmation", () => {
    const draft = prepareScreenshotImport({
      draftId: "draft-confirm",
      snapshotId: "snapshot-confirm",
      sourceAccountId: "wechat-main",
      createdAt: "2026-07-21T10:00:00.000Z",
      extraction: {
        accountName: "WeChat",
        asOf: "2026-07-20T00:00:00.000Z",
        asOfYearVisible: true,
        currency: "CNY",
        totalValue: "125",
        reportedPriorReturn: "25",
        portfolioCash: null,
        confidence: "high",
        warnings: ["Review values"],
        positions: [{
          displayName: "Synthetic Fund",
          instrumentCode: "001234",
          assetType: null,
          quantity: "10",
          currency: "CNY",
          marketValue: "125",
          costBasis: "100",
          reportedPriorReturn: "25",
          reportedPriorReturnPercent: "25",
          averageCost: null,
          observedPrice: null,
          priceAsOf: null,
          priceAsOfYearVisible: false,
          confidence: "high",
        }],
      },
    });
    const readModel = createImportDraftReadModel({ ...draft, status: "draft" });

    expect(createImportDraftConfirmationPayload(readModel)).toEqual({
      confidence: readModel.confidence,
      warnings: readModel.warnings,
      portfolio: readModel.portfolio,
    });
    expect(createImportDraftConfirmationPayload(readModel)).not.toHaveProperty("id");
    expect(createImportDraftConfirmationPayload(readModel)).not.toHaveProperty("sourceAccountId");
  });

  it("preserves inferred evidence until the user changes that field", () => {
    const draft = prepareScreenshotImport({
      draftId: "draft-1",
      snapshotId: "snapshot-1",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-21T10:00:00.000Z",
      extraction: {
        accountName: "Synthetic Provider",
        asOf: "2026-07-20T00:00:00.000Z",
        asOfYearVisible: true,
        currency: "CNY",
        totalValue: "125",
        reportedPriorReturn: "25",
        portfolioCash: null,
        confidence: "high",
        warnings: [],
        positions: [{
          displayName: "Synthetic Fund",
          instrumentCode: "001234",
          assetType: null,
          quantity: "10",
          currency: "CNY",
          marketValue: "125",
          costBasis: null,
          reportedPriorReturn: "25",
          reportedPriorReturnPercent: "25",
          averageCost: null,
          observedPrice: null,
          priceAsOf: null,
          priceAsOfYearVisible: false,
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

  it("marks a corrected vision cash balance as manual evidence", () => {
    const draft = prepareScreenshotImport({
      draftId: "draft-cash",
      snapshotId: "snapshot-cash",
      sourceAccountId: "danske-main",
      createdAt: "2026-07-21T10:00:00.000Z",
      extraction: {
        accountName: "Danske Bank",
        asOf: "2026-07-20T00:00:00.000Z",
        asOfYearVisible: true,
        currency: "EUR",
        totalValue: "75.25",
        reportedPriorReturn: null,
        portfolioCash: { amount: "75.25", currency: "EUR" },
        confidence: "high",
        warnings: [],
        positions: [],
      },
    });
    const readModel = createImportDraftReadModel({ ...draft, status: "draft" });
    readModel.portfolio.portfolioCash = { amount: "72.25", currency: "EUR" };

    const reviewed = applyImportDraftReview(draft, {
      confidence: readModel.confidence,
      warnings: readModel.warnings,
      portfolio: readModel.portfolio,
    });

    expect(reviewed.portfolio.portfolioCash).toEqual({
      status: "known",
      value: { amount: "72.25", currency: "EUR" },
      source: "manual",
    });
  });
});
