import Decimal from "decimal.js";
import { z } from "zod";

import type { OpeningSnapshotInput } from "@/domain/portfolio/types";

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

export interface PreparedScreenshotImport {
  id: string;
  sourceAccountId: string;
  sourceKind: "screenshot" | "demo";
  createdAt: string;
  confidence: string;
  warnings: readonly string[];
  proposedOpeningSnapshot: OpeningSnapshotInput;
}

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

function resolvePositionAccounting(position: ScreenshotExtraction["positions"][number]) {
  if (position.marketValue === null && position.costBasis === null) {
    throw new Error(`${position.displayName} needs a market value or cost basis`);
  }

  if (position.costBasis !== null) {
    const reportedPriorReturn = position.reportedPriorReturn ??
      (position.marketValue === null
        ? "0"
        : new Decimal(position.marketValue).minus(position.costBasis).toString());
    return { costBasis: position.costBasis, reportedPriorReturn };
  }

  const reportedPriorReturn = position.reportedPriorReturn ?? "0";
  return {
    costBasis: new Decimal(position.marketValue!).minus(reportedPriorReturn).toString(),
    reportedPriorReturn,
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

  const positions = extraction.positions.map((position) => {
    const currency = position.currency ?? extraction.currency;
    if (!currency) {
      throw new Error(`${position.displayName} needs a currency`);
    }

    const wholeHoldingMode = position.quantity === null;
    if (wholeHoldingMode) {
      warnings.push(
        `${position.displayName}: the screenshot does not show units; recorded in whole-holding mode.`,
      );
    }

    const accounting = resolvePositionAccounting(position);
    if (position.costBasis === null) {
      warnings.push(
        `${position.displayName}: historical cost basis was inferred as current value minus prior cumulative return; please verify it.`,
      );
    }
    return {
      instrumentId: position.instrumentCode || position.displayName,
      quantity: position.quantity ?? "1",
      currency: currency.toUpperCase(),
      costBasis: accounting.costBasis,
      reportedPriorReturn: accounting.reportedPriorReturn,
    };
  });

  return {
    id: input.draftId,
    sourceAccountId: input.sourceAccountId,
    sourceKind: input.sourceKind ?? "screenshot",
    createdAt: input.createdAt,
    confidence: extraction.confidence,
    warnings,
    proposedOpeningSnapshot: {
      id: input.snapshotId,
      sourceAccountId: input.sourceAccountId,
      asOf: extraction.asOf ?? input.createdAt,
      positions,
    },
  };
}
