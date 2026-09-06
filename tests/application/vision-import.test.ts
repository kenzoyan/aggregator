import { describe, expect, it } from "vitest";

import {
  fixtureVisionExtractor,
  prepareScreenshotImport,
  type ScreenshotExtraction,
} from "@/application/imports/vision-extractor";
import { materializeOpeningSnapshot } from "@/domain/imports";

const extracted: ScreenshotExtraction = {
  accountName: "Synthetic Provider",
  asOf: "2026-07-19T12:00:00.000Z",
  currency: "CNY",
  totalValue: "9999.99",
  reportedPriorReturn: "321.09",
  portfolioCash: null,
  confidence: "medium",
  warnings: ["The screenshot does not show fund units."],
  positions: [
    {
      displayName: "Synthetic Example Fund",
      instrumentCode: null,
      quantity: null,
      currency: "CNY",
      marketValue: "4321.09",
      costBasis: null,
      reportedPriorReturn: "321.09",
      reportedPriorReturnPercent: "8.03",
      averageCost: null,
      observedPrice: null,
      priceAsOf: null,
      confidence: "high",
    },
  ],
};

describe("screenshot import seam", () => {
  it("can use a deterministic fixture without calling a cloud service", async () => {
    const extractor = fixtureVisionExtractor(extracted);

    await expect(
      extractor.extract({
        image: new Uint8Array([1, 2, 3]),
        mimeType: "image/jpeg",
        sourceAccountHint: "Synthetic Provider",
      }),
    ).resolves.toEqual(extracted);
  });

  it("preserves reported history and uses whole-holding mode when units are absent", () => {
    const draft = prepareScreenshotImport({
      draftId: "draft-alipay-1",
      snapshotId: "snapshot-alipay-1",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-19T12:01:00.000Z",
      extraction: extracted,
    });

    expect(
      materializeOpeningSnapshot(draft.sourceAccountId, draft.portfolio)
        .positions,
    ).toEqual([
      {
        instrumentId: "Synthetic Example Fund",
        displayName: "Synthetic Example Fund",
        quantity: "1",
        currency: "CNY",
        costBasis: "4000",
        reportedPriorReturn: "321.09",
        reportedMarketValue: "4321.09",
      },
    ]);
    expect(draft.warnings).toContain(
      "Synthetic Example Fund: the screenshot does not show units; recorded in whole-holding mode.",
    );
    expect(draft.warnings).toContain(
      "Synthetic Example Fund: historical cost basis was inferred as current value minus prior cumulative return; please verify it.",
    );
    expect(draft.portfolio.asOf).toMatchObject({
      status: "known",
      value: extracted.asOf,
      source: "vision",
    });
    expect(draft.portfolio.holdings[0]?.costBasis).toMatchObject({
      status: "inferred",
      value: "4000",
    });
  });

  it("keeps missing accounting facts unknown until the user reviews them", () => {
    const invalid: ScreenshotExtraction = {
      ...extracted,
      positions: [
        {
          ...extracted.positions[0],
          marketValue: null,
          costBasis: null,
        },
      ],
    };

    const draft = prepareScreenshotImport({
      draftId: "draft-invalid",
      snapshotId: "snapshot-invalid",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-19T12:01:00.000Z",
      extraction: invalid,
    });

    expect(draft.portfolio.holdings[0]?.costBasis).toEqual({
      status: "unknown",
    });
    expect(() =>
      materializeOpeningSnapshot(draft.sourceAccountId, draft.portfolio),
    ).toThrow("Holding 1 costBasis is still unknown");
  });

  it("preserves an explicitly visible account cash balance", () => {
    const draft = prepareScreenshotImport({
      draftId: "draft-with-cash",
      snapshotId: "snapshot-with-cash",
      sourceAccountId: "danske-main",
      createdAt: "2026-07-19T12:01:00.000Z",
      extraction: {
        ...extracted,
        accountName: "Danske Bank",
        currency: "EUR",
        portfolioCash: { amount: "75.25", currency: "EUR" },
      },
    });

    expect(draft.portfolio.portfolioCash).toMatchObject({
      status: "known",
      value: { amount: "75.25", currency: "EUR" },
      source: "vision",
    });
  });

  it("creates a reviewable draft from an explicit cash-only account", () => {
    const draft = prepareScreenshotImport({
      draftId: "draft-cash-only",
      snapshotId: "snapshot-cash-only",
      sourceAccountId: "danske-main",
      createdAt: "2026-07-19T12:01:00.000Z",
      extraction: {
        ...extracted,
        accountName: "Danske Bank",
        currency: "EUR",
        totalValue: "75.25",
        portfolioCash: { amount: "75.25", currency: "EUR" },
        positions: [],
      },
    });

    expect(draft.portfolio.holdings).toEqual([]);
    expect(draft.portfolio.portfolioCash).toMatchObject({
      status: "known",
      value: { amount: "75.25", currency: "EUR" },
    });
  });
});
