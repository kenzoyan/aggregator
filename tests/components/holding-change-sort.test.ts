import { describe, expect, it } from "vitest";
import type { HoldingReadModel, Period } from "@/application/portfolio-read-model";
import { nextHoldingChangeSort, sortHoldingsByPeriodChange } from "@/components/holding-change-sort";

function holding(id: string, change: number, available = true, weekChange = change) {
  const performance = (amount: number) => ({ available, change: amount, percent: 1, points: [] });
  return { id, history: { today: performance(change), week: performance(weekChange), month: performance(change) } } satisfies Pick<HoldingReadModel, "id" | "history">;
}

describe("holding period change sorting", () => {
  const input = [holding("loss", -5), holding("missing", 999, false), holding("gain", 10), holding("zero", 0)];
  const ids = (period: Period, order: "default" | "descending" | "ascending") => sortHoldingsByPeriodChange(input, period, order).map((item) => item.id);

  it("orders absolute EUR changes in either direction and leaves missing baselines last", () => {
    expect(ids("today", "descending")).toEqual(["gain", "loss", "zero", "missing"]);
    expect(ids("today", "ascending")).toEqual(["zero", "loss", "gain", "missing"]);
    expect(input.map((item) => item.id)).toEqual(["loss", "missing", "gain", "zero"]);
  });

  it("uses the selected period, preserves equal-value order, and restores the original order", () => {
    const items = [holding("a", 10, true, -5), holding("b", -1, true, 5), holding("c", 10, true, 5)];
    expect(sortHoldingsByPeriodChange(items, "today", "descending").map((item) => item.id)).toEqual(["a", "c", "b"]);
    expect(sortHoldingsByPeriodChange(items, "week", "descending").map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(sortHoldingsByPeriodChange(items, "month", "default")).toEqual(items);
  });

  it("puts a larger loss before a smaller gain and preserves ties with opposite signs", () => {
    const items = [holding("gain", 20), holding("loss", -100), holding("equal-loss", -20)];
    expect(sortHoldingsByPeriodChange(items, "today", "descending").map((item) => item.id)).toEqual(["loss", "gain", "equal-loss"]);
    expect(sortHoldingsByPeriodChange(items, "today", "ascending").map((item) => item.id)).toEqual(["gain", "equal-loss", "loss"]);
  });

  it("keeps absent and non-finite values at the end instead of treating them as zero", () => {
    const items: Array<Pick<HoldingReadModel, "id" | "history">> = [{ id: "absent" }, holding("nan", NaN), holding("loss", -1), holding("infinite", Infinity)];
    expect(sortHoldingsByPeriodChange(items, "today", "ascending").map((item) => item.id)).toEqual(["loss", "absent", "nan", "infinite"]);
    expect(sortHoldingsByPeriodChange([], "today", "descending")).toEqual([]);
  });

  it("cycles through largest first, smallest first, then default", () => {
    expect(nextHoldingChangeSort("default")).toBe("descending");
    expect(nextHoldingChangeSort("descending")).toBe("ascending");
    expect(nextHoldingChangeSort("ascending")).toBe("default");
  });
});
