import Decimal from "decimal.js";
import { z } from "zod";

import {
  inferredDraftValue,
  knownDraftValue,
  unknownDraftValue,
  type DraftHolding,
  type DraftValue,
  type ImportDraftInput,
} from "@/domain/imports";

const nullableMoney = z.string().nullable();

export const screenshotExtractionSchema = z.object({
  accountName: z.string().nullable(),
  asOf: z.string().nullable(),
  currency: z.string().nullable(),
  totalValue: nullableMoney,
  reportedPriorReturn: nullableMoney,
  confidence: z.enum(["low", "medium", "high"]),
  warnings: z.array(z.string()),
  positions: z.array(
    z.object({
      displayName: z.string(),
      instrumentCode: z.string().nullable(),
      quantity: nullableMoney,
      currency: z.string().nullable(),
      marketValue: nullableMoney,
      costBasis: nullableMoney,
      reportedPriorReturn: nullableMoney,
      reportedPriorReturnPercent: nullableMoney,
      confidence: z.enum(["low", "medium", "high"]),
    }),
  ),
});

export type ScreenshotExtraction = z.infer<typeof screenshotExtractionSchema>;

export interface VisionExtractionRequest {
  image: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  sourceAccountHint?: string;
}

export interface VisionExtractor {
  extract(request: VisionExtractionRequest): Promise<ScreenshotExtraction>;
}

export type PreparedScreenshotImport = ImportDraftInput & {
  sourceKind: "screenshot" | "demo";
};

export function fixtureVisionExtractor(
  result: ScreenshotExtraction,
): VisionExtractor {
  const validated = screenshotExtractionSchema.parse(result);

  return {
    async extract() {
      return structuredClone(validated);
    },
  };
}

function resolvePositionAccounting(
  position: ScreenshotExtraction["positions"][number],
  source: "ocr" | "demo",
): {
  costBasis: DraftValue<string>;
  reportedPriorReturn: DraftValue<string>;
} {
  if (position.costBasis !== null) {
    const reportedPriorReturn = position.reportedPriorReturn !== null
      ? knownDraftValue(position.reportedPriorReturn, source, position.confidence)
      : position.marketValue !== null
        ? inferredDraftValue(
            new Decimal(position.marketValue).minus(position.costBasis).toString(),
            "Current value minus source-reported cost basis",
          )
        : unknownDraftValue<string>();
    return {
      costBasis: knownDraftValue(position.costBasis, source, position.confidence),
      reportedPriorReturn,
    };
  }

  if (position.marketValue !== null && position.reportedPriorReturn !== null) {
    return {
      costBasis: inferredDraftValue(
        new Decimal(position.marketValue)
          .minus(position.reportedPriorReturn)
          .toString(),
        "Current value minus reported prior return",
      ),
      reportedPriorReturn: knownDraftValue(
        position.reportedPriorReturn,
        source,
        position.confidence,
      ),
    };
  }

  return {
    costBasis: unknownDraftValue(),
    reportedPriorReturn: position.reportedPriorReturn !== null
      ? knownDraftValue(position.reportedPriorReturn, source, position.confidence)
      : unknownDraftValue(),
  };
}

export function prepareScreenshotImport(input: {
  draftId: string;
  snapshotId: string;
  sourceAccountId: string;
  createdAt: string;
  extraction: ScreenshotExtraction;
  sourceKind?: "screenshot" | "demo";
}): PreparedScreenshotImport {
  const extraction = screenshotExtractionSchema.parse(input.extraction);
  const warnings = [...extraction.warnings];
  const source = input.sourceKind === "demo" ? "demo" as const : "ocr" as const;

  const holdings: DraftHolding[] = extraction.positions.map((position, index) => {
    const currency = position.currency ?? extraction.currency;

    const wholeHoldingMode = position.quantity === null;
    if (wholeHoldingMode) {
      warnings.push(
        `${position.displayName}: the screenshot does not show units; recorded in whole-holding mode.`,
      );
    }

    const accounting = resolvePositionAccounting(position, source);
    if (position.costBasis === null) {
      warnings.push(
        accounting.costBasis.status === "inferred"
          ? `${position.displayName}: historical cost basis was inferred as current value minus prior cumulative return; please verify it.`
          : `${position.displayName}: historical cost basis is unknown; enter it before confirmation.`,
      );
    }
    return {
      lineId: `${input.draftId}:line:${index + 1}`,
      instrumentId: knownDraftValue(
        position.instrumentCode || position.displayName,
        source,
        position.confidence,
      ),
      displayName: knownDraftValue(position.displayName, source, position.confidence),
      instrumentCode: position.instrumentCode
        ? knownDraftValue(position.instrumentCode, source, position.confidence)
        : unknownDraftValue(),
      assetType: unknownDraftValue(),
      quantity: position.quantity !== null
        ? knownDraftValue(position.quantity, source, position.confidence)
        : inferredDraftValue(
            "1",
            "Screenshot does not show units; one represents the whole holding",
          ),
      currency: currency
        ? knownDraftValue(currency.toUpperCase(), source, position.confidence)
        : unknownDraftValue(),
      costBasis: accounting.costBasis,
      reportedPriorReturn: accounting.reportedPriorReturn,
      averageCost: unknownDraftValue(),
      observedPrice: unknownDraftValue(),
      priceAsOf: unknownDraftValue(),
      priceSource: unknownDraftValue(),
      reportedMarketValue: position.marketValue !== null
        ? knownDraftValue(position.marketValue, source, position.confidence)
        : unknownDraftValue(),
    };
  });

  return {
    id: input.draftId,
    sourceAccountId: input.sourceAccountId,
    sourceKind: input.sourceKind ?? "screenshot",
    createdAt: input.createdAt,
    confidence: extraction.confidence,
    warnings,
    portfolio: {
      snapshotId: input.snapshotId,
      asOf: extraction.asOf
        ? knownDraftValue(extraction.asOf, source, extraction.confidence)
        : inferredDraftValue(
            input.createdAt,
            "Screenshot does not show an as-of time; using import time",
          ),
      portfolioCash: unknownDraftValue(),
      holdings,
    },
  };
}
