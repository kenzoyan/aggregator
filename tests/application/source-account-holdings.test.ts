import { describe, expect, it } from "vitest";

import { createSourceAccountHoldingsReadModel } from "@/application/source-account-status";
import type { HoldingReadModel } from "@/application/portfolio-read-model";

const valued: HoldingReadModel = {
  id: "account-a:fund-1",
  sourceAccountId: "account-a",
  name: "Synthetic Fund",
  symbol: "SYN",
  source: "Renamed account",
  category: "Fund",
  currency: "EUR",
  originalValue: "€120.00",
  eurValue: 120,
  changeEur: 0,
  changePercent: 0,
  freshness: "manual",
  asOf: "2026-09-20 09:00",
};

describe("account holdings", () => {
  it("retains account IDs, unvalued positions and cash without leaking another account's valuation", () => {
    const rows = createSourceAccountHoldingsReadModel({
      state: {
        positions: [
          { sourceAccountId: "account-a", instrumentId: "fund-1", displayName: "Synthetic Fund", instrumentCode: "SYN", assetType: "fund", quantity: "10", currency: "EUR", costBasis: "100", reportedPriorReturn: "0" },
          { sourceAccountId: "account-b", instrumentId: "fund-1", displayName: "Other Fund", quantity: "2", currency: "USD", costBasis: "20", reportedPriorReturn: "0" },
        ],
        cashBalances: [{ sourceAccountId: "account-b", currency: "USD", amount: "5" }],
        appliedEventIds: [],
      },
      holdings: [valued],
      missingInputs: [{ kind: "fx", sourceAccountId: "account-b", instrumentId: "fund-1", currency: "USD" }],
    });

    expect(rows.filter((row) => row.sourceAccountId === "account-a")).toEqual([
      expect.objectContaining({ id: "account-a:fund-1", quantity: "10", eurValue: 120, freshness: "manual" }),
    ]);
    expect(rows.filter((row) => row.sourceAccountId === "account-b")).toEqual([
      expect.objectContaining({ id: "account-b:fund-1", name: "Other Fund", quantity: "2", missing: "fx" }),
      expect.objectContaining({ id: "account-b:cash:USD", category: "Portfolio cash", quantity: "5", missing: "fx" }),
    ]);
    expect(rows.filter((row) => row.sourceAccountId === "account-b").every((row) => row.eurValue === undefined)).toBe(true);
  });

  it("returns no rows for an empty account", () => {
    expect(createSourceAccountHoldingsReadModel({
      state: { positions: [], cashBalances: [], appliedEventIds: [] },
      holdings: [],
      missingInputs: [],
    })).toEqual([]);
  });

  it("reports a missing price while retaining a valued cash balance", () => {
    const rows = createSourceAccountHoldingsReadModel({
      state: {
        positions: [{ sourceAccountId: "account-a", instrumentId: "bond-1", quantity: "3", currency: "EUR", costBasis: "30", reportedPriorReturn: "0" }],
        cashBalances: [{ sourceAccountId: "account-a", currency: "EUR", amount: "7" }],
        appliedEventIds: [],
      },
      holdings: [{ ...valued, id: "account-a:cash:EUR", name: "Portfolio Cash", symbol: "CASH", category: "Portfolio cash", originalValue: "€7.00", eurValue: 7 }],
      missingInputs: [{ kind: "price", sourceAccountId: "account-a", instrumentId: "bond-1", currency: "EUR" }],
    });

    expect(rows).toEqual([
      expect.objectContaining({ id: "account-a:bond-1", missing: "price", quantity: "3" }),
      expect.objectContaining({ id: "account-a:cash:EUR", category: "Portfolio cash", quantity: "7", eurValue: 7 }),
    ]);
  });
});
