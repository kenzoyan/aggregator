import { describe, expect, it } from "vitest";

import {
  createDemoPortfolioRecord,
  parseDemoPortfolioRecord,
  toDemoDashboardHoldings,
} from "@/application/demo-portfolio";

describe("confirmed demo portfolio", () => {
  it("round-trips the reviewed holdings and maps them into the demo dashboard", () => {
    const record = createDemoPortfolioRecord({
      confirmedAt: "2026-07-19T12:00:00.000Z",
      snapshot: {
        id: "demo-opening",
        sourceAccountId: "alipay-main",
        asOf: "2026-07-19T11:00:00.000Z",
        positions: [{
          instrumentId: "My Confirmed Demo Fund",
          quantity: "1",
          currency: "CNY",
          costBasis: "5300",
          reportedPriorReturn: "980.50",
        }],
      },
    });

    const restored = parseDemoPortfolioRecord(JSON.stringify(record));
    const holdings = restored ? toDemoDashboardHoldings(restored) : [];

    expect(restored?.snapshot.positions[0]?.instrumentId).toBe("My Confirmed Demo Fund");
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      name: "My Confirmed Demo Fund",
      source: "Alipay",
      category: "Fund",
      currency: "CNY",
      freshness: "manual",
    });
    expect(holdings[0]?.eurValue).toBeGreaterThan(0);
  });

  it("ignores malformed browser storage", () => {
    expect(parseDemoPortfolioRecord("not-json")).toBeUndefined();
    expect(parseDemoPortfolioRecord(JSON.stringify({ version: 99 }))).toBeUndefined();
  });
});
