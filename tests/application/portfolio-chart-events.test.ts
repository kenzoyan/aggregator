import { describe, expect, it } from "vitest";
import { createPortfolioChartEvents, portfolioChartPointsWithEvents } from "@/application/portfolio-chart-events";
import type { PortfolioOverviewInput } from "@/application/portfolio-overview";

function fixture(): PortfolioOverviewInput {
  return {
    asOf: "2026-10-09T18:00:00Z", accountLabels: { demo: "Demo account" },
    marketPrices: [], fxObservations: [],
    snapshots: [{ id: "opening", sourceAccountId: "demo", asOf: "2026-10-01T12:00:00Z",
      positions: [{ instrumentId: "fund", displayName: "Synthetic fund", quantity: "10", costBasis: "1000", currency: "EUR" }] }],
    events: [{ id: "sale", type: "sale", sourceAccountId: "demo", instrumentId: "fund",
      asOf: "2026-10-07T12:00:00Z", quantity: "2", proceeds: { amount: "200", currency: "EUR" },
      destination: { kind: "investment-account" } }],
  };
}

describe("chart event evidence", () => {
  it("uses recorded sale proceeds and identifies retained cash without treating opening holdings as purchases", () => {
    const events = createPortfolioChartEvents(fixture());
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "sale", label: "Sold · Synthetic fund", account: "Demo account",
      amount: { amount: "200", currency: "EUR" }, note: "Proceeds remain in the investment account" });
  });
  it("excludes undone and future records and distinguishes external withdrawals", () => {
    const input = fixture();
    input.events[0]!.voidedAt = "2026-10-08T12:00:00Z";
    input.events.push({ id: "future", type: "cash-withdrawal", sourceAccountId: "demo",
      asOf: "2026-10-10T12:00:00Z", amount: { amount: "50", currency: "EUR" }, destination: { kind: "external-account", name: "Bank" } },
    { id: "withdrawal", type: "cash-withdrawal", sourceAccountId: "demo", asOf: "2026-10-08T12:00:00Z",
      amount: { amount: "100", currency: "EUR" }, destination: { kind: "external-account", name: "Bank" } });
    expect(createPortfolioChartEvents(input)).toMatchObject([{ id: "withdrawal", kind: "withdrawal", note: "To Bank · outside tracked portfolio" }]);
  });
  it("labels an imported increase as a confirmed cost change, without inventing a buy transaction", () => {
    const input = fixture();
    input.events = [];
    input.snapshots.push({ ...input.snapshots[0]!, id: "updated", asOf: "2026-10-08T12:00:00Z",
      positions: [{ ...input.snapshots[0]!.positions[0]!, quantity: "16", costBasis: "1600" }] });
    expect(createPortfolioChartEvents(input)).toMatchObject([{ kind: "holding-update", label: "Units added · Synthetic fund",
      amount: { amount: "600", currency: "EUR" }, note: expect.stringContaining("not a recorded trade amount") }]);
  });
  it("groups multiple events, maps valuation gaps forward, and excludes events outside the chosen period", () => {
    const event = createPortfolioChartEvents(fixture())[0]!;
    const timeline = ["2026-10-06", "2026-10-08", "2026-10-09"].map((asOf) => ({ asOf, valueEur: 1000,
      investmentChangeEur: 0, portfolioActivityEur: 0, holdingActivities: [] }));
    const points = portfolioChartPointsWithEvents(timeline, [event, { ...event, id: "same-day" },
      { ...event, id: "old", asOf: "2026-10-05T12:00:00Z" }, { ...event, id: "later", asOf: "2026-10-10T12:00:00Z" }]);
    expect(points.map((point) => point.events.map((item) => item.id))).toEqual([[], ["sale", "same-day"], []]);
    expect(portfolioChartPointsWithEvents([], [event])).toEqual([]);
  });
});
