import type { ScreenshotExtraction } from "@/application/imports/vision-extraction-contract";

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

export function mergeScreenshotPositions(
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
