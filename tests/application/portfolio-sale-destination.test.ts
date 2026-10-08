import { describe, expect, it } from "vitest";

import { createCurrentPortfolioValuationReadModel } from "@/application/portfolio-current-valuation";
import { createPortfolioHistoryReadModel } from "@/application/portfolio-history";
import { prepareSaleReview } from "@/application/portfolio-sale";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import type { OpeningSnapshotInput } from "@/domain/portfolio/types";

const snapshot: OpeningSnapshotInput = {
  id: "opening", sourceAccountId: "account", asOf: "2020-01-01T00:00:00.000Z",
  positions: [{ instrumentId: "fund", quantity: "60", costBasis: "4800", reportedPriorReturn: "1200", reportedMarketValue: "6000", currency: "EUR" }],
};
const value = (state: ReturnType<typeof buildPortfolioState>) => createCurrentPortfolioValuationReadModel({
  state, snapshots: [snapshot], asOf: "2020-01-03T00:00:00.000Z", snapshotTimes: { account: snapshot.asOf }, eurPerUnit: { EUR: "1" }, fxAsOf: snapshot.asOf,
}).totalValueEur;

describe("sale destination and tracked total", () => {
  it.each(["external-account", "investment-account"] as const)("values the remaining holding correctly for %s", (kind) => {
    const state = buildPortfolioState({ openingSnapshots: [snapshot], events: [] });
    const review = prepareSaleReview({ openingSnapshots: [snapshot], events: [], state }, {
      sourceAccountId: "account", instrumentId: "fund", date: "2020-01-02", quantity: "8", proceeds: "800", fees: "0",
      destination: kind === "external-account" ? { kind, name: "My bank" } : { kind },
    });
    const after = buildPortfolioState({ openingSnapshots: [snapshot], events: [review.event] });
    expect(value(state)).toBe(6000);
    expect(value(after)).toBe(kind === "external-account" ? 5200 : 6000);
    expect(after.positions[0]?.reportedMarketValue).toBe("5200");
    expect(after.positions[0]?.observedPrice).toBe("100");
    expect(review.preview.cashAfter).toBe(kind === "external-account" ? "0" : "800");
  });
  it("classifies an external sale as portfolio activity rather than a price loss", () => {
    const state = buildPortfolioState({ openingSnapshots: [snapshot], events: [] });
    const { event } = prepareSaleReview({ openingSnapshots: [snapshot], events: [], state }, {
      sourceAccountId: "account", instrumentId: "fund", date: "2020-01-02", quantity: "8", proceeds: "800", fees: "0", destination: { kind: "external-account", name: "My bank" },
    });
    const history = createPortfolioHistoryReadModel({ snapshots: [snapshot], events: [event], asOf: "2020-01-03T00:00:00.000Z", eurPerUnit: { EUR: "1" }, fxAsOf: snapshot.asOf }).week;
    expect(history.change).toBe(0);
    expect(history.valueHistory.change).toBe(-800);
    expect(history.valueHistory.portfolioActivity).toBe(-800);
    expect(history.valueHistory.investmentChange).toBe(0);
  });

  it("does not request a price for a fully sold holding", () => {
    const state = buildPortfolioState({ openingSnapshots: [snapshot], events: [] });
    const { event } = prepareSaleReview({ openingSnapshots: [snapshot], events: [], state }, {
      sourceAccountId: "account", instrumentId: "fund", date: "2020-01-02", quantity: "60", proceeds: "6000", fees: "0", destination: { kind: "external-account", name: "My bank" },
    });
    const after = buildPortfolioState({ openingSnapshots: [snapshot], events: [event] });
    const result = createCurrentPortfolioValuationReadModel({ state: after, snapshots: [snapshot], asOf: "2020-01-03T00:00:00.000Z", snapshotTimes: { account: snapshot.asOf }, eurPerUnit: { EUR: "1" }, fxAsOf: snapshot.asOf });
    expect(result.totalValueEur).toBe(0);
    expect(result.missingInputs).toEqual([]);
  });

});
