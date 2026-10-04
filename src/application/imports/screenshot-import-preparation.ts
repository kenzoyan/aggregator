import Decimal from "decimal.js";

import {
  screenshotExtractionSchema,
  type ScreenshotExtraction,
} from "@/application/imports/vision-extraction-contract";
import { mergeScreenshotPositions } from "@/application/imports/vision-position-merge";
import {
  inferredDraftValue,
  knownDraftValue,
  unknownDraftValue,
  type DraftHolding,
  type DraftValue,
  type ImportDraftInput,
} from "@/domain/imports";

export type PreparedScreenshotImport = ImportDraftInput & {
  sourceKind: "screenshot";
};

function resolvePositionAccounting(
  position: ScreenshotExtraction["positions"][number],
  source: "vision",
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
}): PreparedScreenshotImport {
  const extraction = screenshotExtractionSchema.parse(input.extraction);
  const warnings = [...extraction.warnings];
  const source = "vision" as const;
  const positions = mergeScreenshotPositions(extraction.positions, warnings);
  const accountAsOf = extraction.asOfYearVisible ? extraction.asOf : null;
  if (!accountAsOf) {
    warnings.push("The account valuation date is not fully visible; choose the correct date, including year, before confirming.");
  }

  const holdings: DraftHolding[] = positions.map((position, index) => {
    const currency = position.currency ?? extraction.currency;
    const priceAsOf = position.priceAsOfYearVisible ? position.priceAsOf : null;
    if (!priceAsOf && position.observedPrice !== null) {
      warnings.push(`${position.displayName}: the price date is not fully visible; check the NAV / price date before confirming.`);
    }

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
      assetType: position.assetType
        ? knownDraftValue(position.assetType, source, position.confidence)
        : unknownDraftValue(),
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
      averageCost: position.averageCost
        ? knownDraftValue(position.averageCost, source, position.confidence)
        : unknownDraftValue(),
      observedPrice: position.observedPrice
        ? knownDraftValue(position.observedPrice, source, position.confidence)
        : unknownDraftValue(),
      priceAsOf: priceAsOf
        ? knownDraftValue(priceAsOf, source, position.confidence)
        : unknownDraftValue(),
      priceSource: position.observedPrice
        ? knownDraftValue("confirmed-screenshot", source, position.confidence)
        : unknownDraftValue(),
      reportedMarketValue: position.marketValue !== null
        ? knownDraftValue(position.marketValue, source, position.confidence)
        : unknownDraftValue(),
    };
  });

  return {
    id: input.draftId,
    sourceAccountId: input.sourceAccountId,
    sourceKind: "screenshot",
    createdAt: input.createdAt,
    confidence: extraction.confidence,
    warnings,
    portfolio: {
      snapshotId: input.snapshotId,
      asOf: accountAsOf
        ? knownDraftValue(accountAsOf, source, extraction.confidence)
        : unknownDraftValue(),
      portfolioCash: extraction.portfolioCash
        ? knownDraftValue(extraction.portfolioCash, source, extraction.confidence)
        : unknownDraftValue(),
      holdings,
    },
  };
}
