import type { HoldingReadModel, Period } from "@/application/portfolio-read-model";

export type HoldingChangeSort = "default" | "descending" | "ascending";

export function nextHoldingChangeSort(current: HoldingChangeSort): HoldingChangeSort {
  return current === "default" ? "descending" : current === "descending" ? "ascending" : "default";
}

export function sortHoldingsByPeriodChange<T extends Pick<HoldingReadModel, "history">>(
  holdings: readonly T[], period: Period, direction: HoldingChangeSort,
): T[] {
  const sorted = [...holdings];
  if (direction === "default") return sorted;
  const value = (holding: T) => {
    const performance = holding.history?.[period];
    return performance?.available && Number.isFinite(performance.change) ? performance.change : undefined;
  };
  return sorted.sort((left, right) => {
    const a = value(left), b = value(right);
    if (a === undefined) return b === undefined ? 0 : 1;
    if (b === undefined) return -1;
    return direction === "descending" ? Math.abs(b) - Math.abs(a) : Math.abs(a) - Math.abs(b);
  });
}
