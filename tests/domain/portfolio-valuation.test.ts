import { describe, expect, it } from "vitest";

import { valuePortfolio } from "@/domain/portfolio/valuation";
import type { PortfolioState } from "@/domain/portfolio/types";

describe("daily portfolio valuation", () => {
  it("retains a source-reported holding value when NAV multiplication differs by rounding", () => {
    const valuation = valuePortfolio({
      state: {
        positions: [{
          sourceAccountId: "alipay-main",
          instrumentId: "001234",
          quantity: "40.91",
          currency: "CNY",
          costBasis: "340",
          reportedPriorReturn: "-9.75",
        }],
        cashBalances: [],
        appliedEventIds: [],
      },
      asOf: "2026-07-19",
      prices: [{
        sourceAccountId: "alipay-main",
        instrumentId: "001234",
        price: "8.0725",
        reportedMarketValue: "330.25",
        currency: "CNY",
        asOf: "2026-07-16",
        source: "confirmed-csv",
        freshness: "manual",
      }],
      fxRates: [{
        currency: "CNY",
        eurPerUnit: "0.125",
        asOf: "2026-07-18",
        source: "ecb",
      }],
    });

    expect(valuation.positions[0]).toMatchObject({
      originalValue: "330.25",
      eurValue: "41.28125",
    });
  });

  it("keeps original-currency value while aggregating positions and Portfolio Cash in EUR", () => {
    const state: PortfolioState = {
      positions: [
        {
          sourceAccountId: "alipay",
          instrumentId: "fund-001",
          quantity: "10",
          currency: "CNY",
          costBasis: "100",
          reportedPriorReturn: "23.4",
        },
      ],
      cashBalances: [
        {
          sourceAccountId: "alipay",
          currency: "CNY",
          amount: "50",
        },
      ],
      appliedEventIds: [],
    };

    const valuation = valuePortfolio({
      state,
      asOf: "2026-07-20",
      prices: [
        {
          sourceAccountId: "alipay",
          instrumentId: "fund-001",
          price: "12.34",
          currency: "CNY",
          asOf: "2026-07-19",
          source: "manual",
          freshness: "manual",
        },
      ],
      fxRates: [
        {
          currency: "CNY",
          eurPerUnit: "0.128",
          asOf: "2026-07-19",
          source: "ecb",
        },
      ],
    });

    expect(valuation).toEqual({
      asOf: "2026-07-20",
      totalValueEur: "22.1952",
      positions: [
        {
          sourceAccountId: "alipay",
          instrumentId: "fund-001",
          currency: "CNY",
          originalValue: "123.4",
          eurValue: "15.7952",
          priceAsOf: "2026-07-19",
          fxAsOf: "2026-07-19",
          freshness: "manual",
        },
      ],
      cash: [
        {
          sourceAccountId: "alipay",
          currency: "CNY",
          originalValue: "50",
          eurValue: "6.4",
          fxAsOf: "2026-07-19",
        },
      ],
      missingInputs: [],
    });
  });

  it("still returns the valued portion when another holding is missing a price", () => {
    const state: PortfolioState = {
      positions: [
        {
          sourceAccountId: "danske",
          instrumentId: "bond-eur",
          quantity: "1",
          currency: "EUR",
          costBasis: "18",
          reportedPriorReturn: "2",
        },
        {
          sourceAccountId: "alipay",
          instrumentId: "fund-cny",
          quantity: "10",
          currency: "CNY",
          costBasis: "100",
          reportedPriorReturn: "0",
        },
      ],
      cashBalances: [
        { sourceAccountId: "danske", currency: "EUR", amount: "5" },
      ],
      appliedEventIds: [],
    };

    const valuation = valuePortfolio({
      state,
      asOf: "2026-07-20",
      prices: [
        {
          sourceAccountId: "danske",
          instrumentId: "bond-eur",
          price: "20",
          currency: "EUR",
          asOf: "2026-07-20",
          source: "danske",
          freshness: "fresh",
        },
      ],
      fxRates: [],
    });

    expect(valuation.totalValueEur).toBe("25");
    expect(valuation.positions[0]).toMatchObject({
      instrumentId: "bond-eur",
      originalValue: "20",
      eurValue: "20",
      fxAsOf: "2026-07-20",
    });
    expect(valuation.cash[0]?.eurValue).toBe("5");
    expect(valuation.missingInputs).toEqual([
      { kind: "price", instrumentId: "fund-cny", currency: "CNY" },
    ]);
  });

  it("does not reuse another Source Account's price for the same instrument id", () => {
    const valuation = valuePortfolio({
      state: {
        positions: [
          {
            sourceAccountId: "account-a",
            instrumentId: "shared-id",
            quantity: "1",
            currency: "EUR",
            costBasis: "10",
            reportedPriorReturn: "0",
          },
          {
            sourceAccountId: "account-b",
            instrumentId: "shared-id",
            quantity: "1",
            currency: "EUR",
            costBasis: "20",
            reportedPriorReturn: "0",
          },
        ],
        cashBalances: [],
        appliedEventIds: [],
      },
      asOf: "2026-07-20",
      prices: [
        {
          sourceAccountId: "account-a",
          instrumentId: "shared-id",
          price: "11",
          currency: "EUR",
          asOf: "2026-07-20",
          source: "fixture",
          freshness: "fresh",
        },
        {
          sourceAccountId: "account-b",
          instrumentId: "shared-id",
          price: "22",
          currency: "EUR",
          asOf: "2026-07-20",
          source: "fixture",
          freshness: "fresh",
        },
      ],
      fxRates: [],
    });

    expect(valuation.positions.map((position) => position.originalValue))
      .toEqual(["11", "22"]);
  });
});
