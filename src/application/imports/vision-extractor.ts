import Decimal from "decimal.js";

import {
  screenshotExtractionSchema,
  type ScreenshotExtraction,
  type VisionExtractor,
} from "@/application/imports/vision-extraction-contract";
import {
  inferredDraftValue,
  knownDraftValue,
  unknownDraftValue,
  type DraftHolding,
  type DraftValue,
  type ImportDraftInput,
} from "@/domain/imports";
import type { SourceProvider } from "@/domain/source-accounts";

export * from "@/application/imports/vision-extraction-contract";

const sourceProviderPatterns: ReadonlyArray<[
  SourceProvider,
  RegExp,
]> = [
  ["alipay", /alipay|支付宝/i],
  ["wechat", /wechat|微信|理财通/i],
  ["danske", /danske/i],
  ["trading212", /trading\s*212/i],
];

export function detectedSourceProvider(
  accountName: string | null,
): SourceProvider | undefined {
  if (!accountName) return undefined;
  return sourceProviderPatterns.find(([, pattern]) =>
    pattern.test(accountName)
  )?.[0];
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
  source: "vision" | "demo",
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

type ExtractedPosition = ScreenshotExtraction["positions"][number];

type MergeablePositionField = Exclude<
  keyof ExtractedPosition,
  "displayName" | "instrumentCode" | "confidence"
>;

function normalizedInstrumentCode(position: ExtractedPosition): string | undefined {
  return position.instrumentCode?.replaceAll(/\s/g, "").toUpperCase() || undefined;
}

function normalizedPositionName(position: ExtractedPosition): string {
  return position.displayName.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function lowerConfidence(
  left: ExtractedPosition["confidence"],
  right: ExtractedPosition["confidence"],
): ExtractedPosition["confidence"] {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[left] <= rank[right] ? left : right;
}

function mergeDuplicatePositions(
  positions: readonly ExtractedPosition[],
  warnings: string[],
): ExtractedPosition[] {
  const codedGroups = new Map<string, ExtractedPosition[]>();
  const uncodedGroups = new Map<string, ExtractedPosition[]>();
  const codesByName = new Map<string, Set<string>>();

  for (const position of positions) {
    const code = normalizedInstrumentCode(position);
    const name = normalizedPositionName(position);
    if (!code) {
      uncodedGroups.set(name, [...(uncodedGroups.get(name) ?? []), position]);
      continue;
    }
    codedGroups.set(code, [...(codedGroups.get(code) ?? []), position]);
    const codes = codesByName.get(name) ?? new Set<string>();
    codes.add(code);
    codesByName.set(name, codes);
  }

  const groups: Array<{
    code: string | undefined;
    rows: ExtractedPosition[];
  }> = [...codedGroups.entries()].map(([code, rows]) => ({ code, rows }));
  for (const [name, rows] of uncodedGroups) {
    const matchingCodes = [...(codesByName.get(name) ?? [])];
    if (matchingCodes.length === 1) {
      groups.find((group) => group.code === matchingCodes[0])!.rows.push(...rows);
    } else {
      groups.push({ code: undefined, rows });
    }
  }

  const confidenceRank = { low: 0, medium: 1, high: 2 } as const;
  const completeness = (position: ExtractedPosition) =>
    Object.values(position).filter((value) => value !== null).length;
  const canonical = (position: ExtractedPosition) => JSON.stringify(position);
  const compareText = (left: string, right: string) =>
    left < right ? -1 : left > right ? 1 : 0;
  const preferredFirst = (left: ExtractedPosition, right: ExtractedPosition) =>
    confidenceRank[right.confidence] - confidenceRank[left.confidence] ||
    completeness(right) - completeness(left) ||
    compareText(canonical(left), canonical(right));

  return groups
    .sort((left, right) => compareText(
      left.code ?? normalizedPositionName(left.rows[0]!),
      right.code ?? normalizedPositionName(right.rows[0]!),
    ))
    .map(({ code, rows }) => {
      const ranked = [...rows].sort(preferredFirst);
      const displayName = [...rows]
        .map((row) => row.displayName)
        .sort((left, right) =>
          right.length - left.length || compareText(left, right)
        )[0]!;
      function mergedField<K extends MergeablePositionField>(
        field: K,
      ): ExtractedPosition[K] {
        const values = ranked
          .map((row) => row[field])
          .filter((value): value is NonNullable<ExtractedPosition[K]> => value !== null);
        const distinct = new Set(values);
        if (distinct.size > 1) {
          warnings.push(
            `${displayName}: conflicting ${field} values were detected across screenshots; selected a deterministic value for review.`,
          );
        }
        return values[0] ?? null;
      }
      return {
        displayName,
        instrumentCode: code ?? null,
        assetType: mergedField("assetType"),
        quantity: mergedField("quantity"),
        currency: mergedField("currency"),
        marketValue: mergedField("marketValue"),
        costBasis: mergedField("costBasis"),
        reportedPriorReturn: mergedField("reportedPriorReturn"),
        reportedPriorReturnPercent: mergedField("reportedPriorReturnPercent"),
        averageCost: mergedField("averageCost"),
        observedPrice: mergedField("observedPrice"),
        priceAsOf: mergedField("priceAsOf"),
        confidence: rows.reduce<ExtractedPosition["confidence"]>(
          (result, row) => lowerConfidence(result, row.confidence),
          "high",
        ),
      };
    });
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
  const source = input.sourceKind === "demo" ? "demo" as const : "vision" as const;
  const positions = mergeDuplicatePositions(extraction.positions, warnings);

  const holdings: DraftHolding[] = positions.map((position, index) => {
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
      priceAsOf: position.priceAsOf
        ? knownDraftValue(position.priceAsOf, source, position.confidence)
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
      portfolioCash: extraction.portfolioCash
        ? knownDraftValue(extraction.portfolioCash, source, extraction.confidence)
        : unknownDraftValue(),
      holdings,
    },
  };
}
