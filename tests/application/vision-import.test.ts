import { describe, expect, it } from "vitest";

import {
  fixtureVisionExtractor,
  prepareScreenshotImport,
  type ScreenshotExtraction,
} from "@/application/imports/vision-extractor";
import { createImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import { materializeOpeningSnapshot } from "@/domain/imports";

const extracted: ScreenshotExtraction = {
  accountName: "Synthetic Provider",
  asOf: "2026-07-19T12:00:00.000Z",
  asOfYearVisible: true,
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
      assetType: null,
      quantity: null,
      currency: "CNY",
      marketValue: "4321.09",
      costBasis: null,
      reportedPriorReturn: "321.09",
      reportedPriorReturnPercent: "8.03",
      averageCost: null,
      observedPrice: null,
      priceAsOf: null,
      priceAsOfYearVisible: false,
      confidence: "high",
    },
  ],
};

describe("screenshot import seam", () => {
  it("can use a deterministic fixture without calling a cloud service", async () => {
    const extractor = fixtureVisionExtractor(extracted);

    await expect(
      extractor.extract({
        images: [{
          image: new Uint8Array([1, 2, 3]),
          mimeType: "image/jpeg",
        }],
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

  it("does not turn a month-day screenshot into a guessed valuation or price year", () => {
    const draft = prepareScreenshotImport({
      draftId: "draft-uncertain-date",
      snapshotId: "snapshot-uncertain-date",
      sourceAccountId: "alipay-main",
      createdAt: "2026-10-01T12:00:00.000Z",
      extraction: {
        ...extracted,
        asOf: "2024-09-22T00:00:00.000Z",
        asOfYearVisible: false,
        positions: [{
          ...extracted.positions[0]!,
          observedPrice: "0.625",
          priceAsOf: "2024-09-22T00:00:00.000Z",
          priceAsOfYearVisible: false,
        }],
      },
    });

    expect(draft.portfolio.asOf).toEqual({ status: "unknown" });
    expect(draft.portfolio.holdings[0]?.priceAsOf).toEqual({ status: "unknown" });
    expect(createImportDraftReadModel({ ...draft, status: "draft" }).portfolio.asOf).toBe("");
    expect(draft.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("choose the correct date, including year"),
      expect.stringContaining("check the NAV / price date"),
    ]));
    expect(() => materializeOpeningSnapshot(draft.sourceAccountId, draft.portfolio))
      .toThrow("Portfolio asOf is still unknown");
  });

  it("keeps a price date when a complementary screenshot supplies its visible year", () => {
    const draft = prepareScreenshotImport({
      draftId: "draft-complementary-dates",
      snapshotId: "snapshot-complementary-dates",
      sourceAccountId: "alipay-main",
      createdAt: "2026-10-01T12:00:00.000Z",
      extraction: {
        ...extracted,
        positions: [
          {
            ...extracted.positions[0]!,
            instrumentCode: "XX0000000001",
            observedPrice: "0.625",
            priceAsOf: "2026-09-22T00:00:00.000Z",
            priceAsOfYearVisible: false,
          },
          {
            ...extracted.positions[0]!,
            instrumentCode: "XX0000000001",
            observedPrice: "0.625",
            priceAsOf: "2026-09-22T00:00:00.000Z",
            priceAsOfYearVisible: true,
          },
        ],
      },
    });

    expect(draft.portfolio.holdings).toHaveLength(1);
    expect(draft.portfolio.holdings[0]?.priceAsOf).toMatchObject({
      status: "known",
      value: "2026-09-22T00:00:00.000Z",
    });
  });

  it("merges complementary duplicate views deterministically by ISIN", () => {
    const draft = prepareScreenshotImport({
      draftId: "draft-duplicates",
      snapshotId: "snapshot-duplicates",
      sourceAccountId: "danske-main",
      createdAt: "2026-09-06T12:00:00.000Z",
      extraction: {
        ...extracted,
        currency: "EUR",
        positions: [
          {
            ...extracted.positions[0],
            displayName: "Synthetic Fund",
            instrumentCode: "XX0000000001",
            quantity: "10",
            marketValue: "120",
            costBasis: null,
            reportedPriorReturn: "20",
            observedPrice: null,
          },
          {
            ...extracted.positions[0],
            displayName: "Synthetic Fund Long Name",
            instrumentCode: "xx0000000001",
            quantity: "10",
            marketValue: "121",
            costBasis: null,
            reportedPriorReturn: null,
            observedPrice: "12",
          },
        ],
      },
    });

    expect(draft.portfolio.holdings).toHaveLength(1);
    expect(draft.portfolio.holdings[0]).toMatchObject({
      displayName: { value: "Synthetic Fund Long Name" },
      instrumentCode: { value: "XX0000000001" },
      quantity: { value: "10" },
      reportedMarketValue: { value: "121" },
      observedPrice: { value: "12" },
      costBasis: { value: "101", status: "inferred" },
    });
    expect(draft.warnings).toContain(
      "Synthetic Fund Long Name: conflicting marketValue values were detected across screenshots; selected a deterministic value for review.",
    );
  });

  it("produces the same merge when duplicate views are reversed", () => {
    const overview = {
      ...extracted.positions[0],
      displayName: "Synthetic Fund",
      instrumentCode: null,
      currency: "EUR" as const,
      quantity: "10",
      observedPrice: null,
    };
    const details = {
      ...overview,
      instrumentCode: "XX0000000001",
      quantity: null,
      observedPrice: "12",
    };
    const prepare = (positions: ScreenshotExtraction["positions"]) =>
      prepareScreenshotImport({
        draftId: "draft-order",
        snapshotId: "snapshot-order",
        sourceAccountId: "danske-main",
        createdAt: "2026-09-06T12:00:00.000Z",
        extraction: { ...extracted, currency: "EUR", positions },
      }).portfolio.holdings;

    expect(prepare([overview, details])).toEqual(prepare([details, overview]));
    expect(prepare([overview, details])).toHaveLength(1);
    expect(prepare([overview, details])[0]).toMatchObject({
      instrumentCode: { value: "XX0000000001" },
      quantity: { value: "10" },
      observedPrice: { value: "12" },
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
