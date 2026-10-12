import { describe, expect, it } from "vitest";
import { currentHoldingsPnl } from "@/application/current-holdings-pnl";
import type { HoldingReadModel } from "@/application/portfolio-read-model";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import { createCurrentPortfolioValuationReadModel } from "@/application/portfolio-current-valuation";

function holding(id: string, eurValue: number, pnlEur?: number, category: HoldingReadModel["category"] = "Fund"): HoldingReadModel {
  return { id, sourceAccountId: "synthetic", name: id, symbol: id, source: "Demo", category, currency: "EUR",
    originalValue: String(eurValue), eurValue, changeEur: 0, changePercent: 0, freshness: "manual", asOf: "2026-10-12",
    ...(pnlEur === undefined ? {} : { totalReturn: { originalAmount: pnlEur, eurAmount: pnlEur } }) };
}

describe("current investment holdings P&L", () => {
  it("combines EUR-translated P&L with a cost-weighted percentage, excluding cash", () => {
    const result = currentHoldingsPnl({ holdings: [holding("a", 120, 20),
      { ...holding("b", 230, 30, "ETF"), currency: "CNY", totalReturn: { originalAmount: 240, eurAmount: 30, percent: 15 } },
      holding("cash", 999, 999, "Portfolio cash")], missingInputs: [] });
    expect(result).toMatchObject({ coverage: "complete", totalHoldingCount: 2, includedHoldingCount: 2, pnlEur: 50, costEur: 300 });
    expect(result.percent).toBeCloseTo(50 / 300 * 100);
  });

  it("keeps incomplete coverage explicit and deduplicates missing investment inputs", () => {
    const result = currentHoldingsPnl({ holdings: [holding("a", 90, -10), holding("b", 100)], missingInputs: [
      { sourceAccountId: "synthetic", instrumentId: "missing", currency: "CNY", kind: "price" },
      { sourceAccountId: "synthetic", instrumentId: "missing", currency: "CNY", kind: "fx" },
      { sourceAccountId: "synthetic", currency: "USD", kind: "fx" },
    ] });
    expect(result).toMatchObject({ coverage: "partial", includedHoldingCount: 1, totalHoldingCount: 3, pnlEur: -10, percent: -10 });
  });

  it("does not show a false zero when no holdings can be calculated", () => {
    expect(currentHoldingsPnl({ holdings: [holding("cash", 10, undefined, "Portfolio cash")], missingInputs: [] })).toEqual({
      coverage: "empty", includedHoldingCount: 0, totalHoldingCount: 0,
    });
    expect(currentHoldingsPnl({ holdings: [holding("invalid", 10, NaN)], missingInputs: [] })).toEqual({
      coverage: "unavailable", includedHoldingCount: 0, totalHoldingCount: 1,
    });
    expect(currentHoldingsPnl({ holdings: [holding("free", 10, 10)], missingInputs: [] })).toEqual({
      coverage: "complete", includedHoldingCount: 1, totalHoldingCount: 1, pnlEur: 10, costEur: 0,
    });
  });

  it("counts only remaining cost and unrealised P&L after a partial sale", () => {
    const snapshots = [{ id: "demo", sourceAccountId: "demo", asOf: "2026-10-01T12:00:00Z",
      positions: [{ instrumentId: "stock", assetType: "stock" as const, quantity: "10", currency: "EUR", costBasis: "100", observedPrice: "15" }] }];
    const state = buildPortfolioState({ openingSnapshots: snapshots, events: [{ id: "sale", type: "sale", sourceAccountId: "demo",
      instrumentId: "stock", asOf: "2026-10-02T12:00:00Z", quantity: "5", proceeds: { amount: "100", currency: "EUR" } }] });
    const portfolio = createCurrentPortfolioValuationReadModel({ state, snapshots, asOf: "2026-10-12T12:00:00Z",
      snapshotTimes: { demo: snapshots[0].asOf }, eurPerUnit: { EUR: "1" }, fxAsOf: "2026-10-12" });
    expect(currentHoldingsPnl(portfolio)).toMatchObject({ coverage: "complete", includedHoldingCount: 1, pnlEur: 25, costEur: 50, percent: 50 });
  });
});
