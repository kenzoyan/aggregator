import { describe, expect, it } from "vitest";
import { holdingsPnlBreakdown, largestPnlContributions } from "@/application/holdings-pnl-breakdown";
import { currentHoldingsPnl } from "@/application/current-holdings-pnl";
import type { HoldingReadModel } from "@/application/portfolio-read-model";

function holding(id: string, pnl: number | undefined, account = "a"): HoldingReadModel {
  return { id, name: id, sourceAccountId: account, source: "Same display name", symbol: id,
    category: "Fund", currency: "EUR", originalValue: "100", eurValue: 100,
    changeEur: 0, changePercent: 0, freshness: "manual", asOf: "2026-10-12",
    ...(pnl === undefined ? {} : { totalReturn: { eurAmount: pnl, originalAmount: pnl } }) };
}

describe("current holdings P&L contribution", () => {
  it("shows only the five largest absolute contributions across gains and losses", () => {
    const data = holdingsPnlBreakdown([holding("small", 1), holding("loss", -90), holding("gain", 80),
      holding("third", -70), holding("fourth", 60), holding("fifth", -50), holding("sixth", 40)], "holding");
    expect(largestPnlContributions(data).map((entry) => entry.id)).toEqual(["loss", "gain", "third", "fourth", "fifth"]);
    expect(data.netEur).toBe(-29);
    expect(largestPnlContributions(holdingsPnlBreakdown([], "account"))).toEqual([]);
  });
  it("splits gains and losses with sign-specific shares, preserving the headline net", () => {
    const holdings = [holding("one", 30), holding("two", 10), holding("three", -30), holding("flat", 0)];
    const result = holdingsPnlBreakdown(holdings, "holding");
    expect(result).toMatchObject({ gainTotalEur: 40, lossTotalEur: 30, netEur: 10, unchangedCount: 1 });
    expect(result.gains.map((entry) => entry.sharePercent)).toEqual([75, 25]);
    expect(result.losses[0].sharePercent).toBe(100);
    expect(result.netEur).toBe(currentHoldingsPnl({ holdings, missingInputs: [] }).pnlEur);
  });
  it("nets within each account and groups by ID even with identical display names", () => {
    const holdings = [holding("one", 30), holding("two", -20), holding("three", -5, "b")];
    const result = holdingsPnlBreakdown(holdings, "account");
    expect(result.gains[0]).toMatchObject({ id: "a", pnlEur: 10, sharePercent: 100 });
    expect(result.losses[0]).toMatchObject({ id: "b", pnlEur: -5, sharePercent: 100 });
    expect(result.netEur).toBe(holdingsPnlBreakdown(holdings, "holding").netEur);
  });
  it("excludes cash, missing data and invalid costs with the same eligibility as the headline", () => {
    const holdings = [holding("valid", -1), holding("missing", undefined), holding("nan", NaN),
      holding("negative-cost", 101), { ...holding("cash", 10), category: "Portfolio cash" as const }];
    expect(holdingsPnlBreakdown(holdings, "holding").netEur).toBe(-1);
    expect(currentHoldingsPnl({ holdings, missingInputs: [] }).pnlEur).toBe(-1);
  });
  it("handles empty, all-zero, cancelling and decimal contributions without invalid percentages", () => {
    expect(holdingsPnlBreakdown([], "holding")).toMatchObject({ gains: [], losses: [], netEur: 0 });
    expect(holdingsPnlBreakdown([holding("flat", 0)], "holding").unchangedCount).toBe(1);
    expect(holdingsPnlBreakdown([holding("a", .1), holding("b", .2), holding("c", -.3)], "account"))
      .toMatchObject({ gains: [], losses: [], netEur: 0, unchangedCount: 1 });
  });
});
