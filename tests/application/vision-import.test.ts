import { describe, expect, it } from "vitest";

import {
  fixtureVisionExtractor,
  prepareScreenshotImport,
  type ScreenshotExtraction,
} from "@/application/imports/vision-extractor";

const extracted: ScreenshotExtraction = {
  accountName: "Synthetic Provider",
  asOf: "2026-07-19T12:00:00.000Z",
  currency: "CNY",
  totalValue: "9999.99",
  reportedPriorReturn: "321.09",
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

    expect(draft.proposedOpeningSnapshot.positions).toEqual([
      {
        instrumentId: "Synthetic Example Fund",
        quantity: "1",
        currency: "CNY",
        costBasis: "4000",
        reportedPriorReturn: "321.09",
      },
    ]);
    expect(draft.warnings).toContain(
      "Synthetic Example Fund: the screenshot does not show units; recorded in whole-holding mode.",
    );
    expect(draft.warnings).toContain(
      "Synthetic Example Fund: historical cost basis was inferred as current value minus prior cumulative return; please verify it.",
    );
    expect(draft.proposedOpeningSnapshot.asOf).toBe(extracted.asOf);
  });

  it("rejects a row when current value cannot be reconciled", () => {
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

    expect(() =>
      prepareScreenshotImport({
        draftId: "draft-invalid",
        snapshotId: "snapshot-invalid",
        sourceAccountId: "alipay-main",
        createdAt: "2026-07-19T12:01:00.000Z",
        extraction: invalid,
      }),
    ).toThrow("needs a market value or cost basis");
  });
});
