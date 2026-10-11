import { describe, expect, it } from "vitest";
import { createPortfolioPeriodAnalysis, sortPeriodContributions } from "@/application/portfolio-period-analysis";
import { createPortfolioValuationTimeline } from "@/application/portfolio-valuation-timeline";
import type { OpeningSnapshotInput } from "@/domain/portfolio/types";

const asOf = "2026-10-11T20:00:00.000Z";
function snapshot(id: string, date: string, prices: number[], quantity = "1"): OpeningSnapshotInput {
  return { id, sourceAccountId: "synthetic", asOf: date, positions: prices.map((price, index) => ({
    instrumentId: `fund-${index}`, displayName: `Fund ${index}`, quantity, currency: "EUR", costBasis: "100", observedPrice: String(price),
  })) };
}
function portfolio(snapshots: OpeningSnapshotInput[]) {
  return createPortfolioValuationTimeline({ snapshots, events: [], marketPrices: [], fxObservations: [], accountLabels: { synthetic: "Test account" }, asOf });
}

describe("full period contribution analysis", () => {
  it("returns every holding beyond the five evidence drivers and reconciles offsetting changes", () => {
    const data = portfolio([snapshot("base", "2026-10-04T12:00:00.000Z", [100,100,100,100,100,100]),
      snapshot("end", "2026-10-11T12:00:00.000Z", [110,90,105,95,102,98])]);
    const analysis = createPortfolioPeriodAnalysis(data, "week", asOf);
    expect(analysis.holdings).toHaveLength(6);
    expect(analysis.holdings.every((row) => row.status === "included")).toBe(true);
    expect(analysis.investmentChangeEur).toBe(0);
    expect(analysis.contributionSumEur).toBe(0);
    expect(analysis.reconciliationResidualEur).toBe(0);
    expect(analysis.decompositionResidualEur).toBe(0);
    expect(sortPeriodContributions(analysis.holdings, "gainers")[0].contribution?.change).toBe(10);
    expect(sortPeriodContributions(analysis.holdings, "decliners")[0].contribution?.change).toBe(-10);
    expect(analysis.holdings[0].id).toBe("synthetic:fund-0");
  });

  it("uses current quantities without counting added units as returns", () => {
    const data = portfolio([snapshot("base", "2026-10-04T12:00:00.000Z", [100]),
      snapshot("end", "2026-10-11T12:00:00.000Z", [110], "2")]);
    const analysis = createPortfolioPeriodAnalysis(data, "week", asOf);
    expect(analysis.investmentChangeEur).toBe(20);
    expect(analysis.holdings[0].contribution).toMatchObject({ change: 20, baselineValueEur: 200, currentValueEur: 220, priceChange: 20, fxChange: 0 });
    expect(analysis.totalValueChangeEur).toBe(120);
    expect(analysis.estimatedActivityEur).toBe(100);
  });

  it("separates price and FX at the exact contribution endpoints", () => {
    const data = createPortfolioValuationTimeline({
      snapshots: [{ ...snapshot("base", "2026-10-04T12:00:00.000Z", [100]), positions: [{ instrumentId: "fund", quantity: "2", currency: "USD", costBasis: "200", observedPrice: "100" }] },
        { ...snapshot("end", "2026-10-11T12:00:00.000Z", [110]), positions: [{ instrumentId: "fund", quantity: "2", currency: "USD", costBasis: "200", observedPrice: "110" }] }],
      events: [], marketPrices: [], fxObservations: [
        { currency: "USD", eurPerUnit: "0.9", asOf: "2026-10-04", recordedAt: "2026-10-04", source: "ecb" },
        { currency: "USD", eurPerUnit: "0.8", asOf: "2026-10-11", recordedAt: "2026-10-11", source: "ecb" }], accountLabels: {}, asOf,
    });
    const analysis = createPortfolioPeriodAnalysis(data, "week", asOf);
    expect(analysis.investmentChangeEur).toBeCloseTo(-4);
    expect(analysis.priceEffectEur).toBeCloseTo(18);
    expect(analysis.fxEffectEur).toBeCloseTo(-22);
    expect(analysis.decompositionResidualEur).toBeCloseTo(0);
  });

  it("lists a fully exited holding as excluded rather than inventing a loss", () => {
    const data = portfolio([snapshot("base", "2026-10-04T12:00:00.000Z", [100,100]),
      snapshot("end", "2026-10-11T12:00:00.000Z", [110])]);
    const analysis = createPortfolioPeriodAnalysis(data, "week", asOf);
    expect(analysis.holdings.find((row) => row.id === "synthetic:fund-1")).toMatchObject({ status: "excluded-closed", sourceAccountId: "synthetic" });
    expect(analysis.investmentChangeEur).toBe(10);
    expect(analysis.totalValueChangeEur).toBe(-90);
    expect(analysis.estimatedActivityEur).toBeUndefined();
    expect(analysis.activityCoverage).toBe("unavailable");
    expect(analysis.coverage).toBe("partial");
  });

  it("does not call a cash withdrawal an investment loss", () => {
    const data = portfolio([{ ...snapshot("base", "2026-10-04T12:00:00.000Z", [100]), portfolioCash: { amount: "100", currency: "EUR" } },
      { ...snapshot("end", "2026-10-11T12:00:00.000Z", [100]), portfolioCash: { amount: "50", currency: "EUR" } }]);
    const analysis = createPortfolioPeriodAnalysis(data, "week", asOf);
    expect(analysis.investmentChangeEur).toBe(0);
    expect(analysis.totalValueChangeEur).toBe(-50);
    expect(analysis.estimatedActivityEur).toBe(-50);
    expect(analysis.holdings.find((row) => row.category === "Portfolio cash")?.contribution?.change).toBe(0);
  });

  it("keeps missing baselines unavailable and lists unvalued instruments", () => {
    const data = portfolio([{ ...snapshot("only", "2026-10-11T12:00:00.000Z", [100]), positions: [
      { instrumentId: "no-baseline", quantity: "1", currency: "EUR", costBasis: "100" },
      { instrumentId: "missing-fx", quantity: "1", currency: "USD", costBasis: "0", observedPrice: "100" },
    ] }]);
    const analysis = createPortfolioPeriodAnalysis(data, "week", asOf);
    expect(analysis.available).toBe(false);
    expect(analysis.investmentChangeEur).toBeUndefined();
    expect(analysis.priceEffectEur).toBeUndefined();
    expect(analysis.holdings).toHaveLength(2);
    expect(analysis.holdings.find((row) => row.id === "synthetic:no-baseline")?.status).toBe("missing-baseline");
    expect(analysis.holdings.find((row) => row.id === "synthetic:missing-fx")?.status).toBe("missing-valuation");
  });

  it("preserves mismatched reconciliation and decomposition instead of forcing zero", () => {
    const data = portfolio([snapshot("base", "2026-10-04T12:00:00.000Z", [100]), snapshot("end", "2026-10-11T12:00:00.000Z", [110])]);
    data.history.week.change = 15;
    const analysis = createPortfolioPeriodAnalysis(data, "week", asOf);
    expect(analysis.reconciliationResidualEur).toBe(5);
    expect(analysis.decompositionResidualEur).toBe(5);
    expect(data.history.week.change).toBe(15);
  });

  it("keeps unvalued cash in separate accounts rather than merging currency gaps", () => {
    const data = portfolio(["first", "second"].map((sourceAccountId) => ({ id: sourceAccountId, sourceAccountId,
      asOf: "2026-10-11T12:00:00Z", positions: [], portfolioCash: { amount: "100", currency: "USD" } })));
    const analysis = createPortfolioPeriodAnalysis(data, "week", asOf);
    expect(analysis.holdings.map((holding) => holding.id).sort()).toEqual(["first:cash:USD", "second:cash:USD"]);
    expect(analysis.holdings.every((holding) => holding.status === "missing-valuation")).toBe(true);
  });
});
