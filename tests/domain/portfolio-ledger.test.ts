import { describe, expect, it } from "vitest";

import { buildPortfolioState } from "@/domain/portfolio/ledger";

describe("portfolio ledger", () => {
  it("uses the latest holding state without overwriting the first reported prior return", () => {
    const state = buildPortfolioState({
      openingSnapshots: [
        {
          id: "alipay-old",
          sourceAccountId: "alipay",
          asOf: "2026-07-01T00:00:00.000Z",
          positions: [
            {
              instrumentId: "fund-a",
              quantity: "1",
              currency: "CNY",
              costBasis: "800",
              reportedPriorReturn: "200",
            },
          ],
        },
        {
          id: "alipay-new",
          sourceAccountId: "alipay",
          asOf: "2026-07-19T00:00:00.000Z",
          positions: [
            {
              instrumentId: "fund-a",
              quantity: "1",
              currency: "CNY",
              costBasis: "800",
              reportedPriorReturn: "260",
            },
            {
              instrumentId: "fund-b",
              quantity: "1",
              currency: "CNY",
              costBasis: "100",
              reportedPriorReturn: "10",
            },
          ],
        },
      ],
      events: [],
    });

    expect(state.positions).toHaveLength(2);
    expect(state.positions[0]?.reportedPriorReturn).toBe("200");
    expect(state.positions[1]?.reportedPriorReturn).toBe("10");
  });

  it("starts monitoring from an Opening Snapshot without treating its value as new principal", () => {
    const state = buildPortfolioState({
      openingSnapshots: [
        {
          id: "opening-alipay",
          sourceAccountId: "alipay",
          asOf: "2026-07-19T09:00:00.000Z",
          portfolioCash: { amount: "50.00", currency: "CNY" },
          positions: [
            {
              instrumentId: "fund-001",
              quantity: "10",
              currency: "CNY",
              costBasis: "800.00",
              reportedPriorReturn: "200.00",
            },
          ],
        },
      ],
      events: [],
    });

    expect(state).toEqual({
      positions: [
        {
          sourceAccountId: "alipay",
          instrumentId: "fund-001",
          quantity: "10",
          currency: "CNY",
          costBasis: "800",
          reportedPriorReturn: "200",
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
    });
  });

  it("moves sale proceeds into Portfolio Cash and reduces Cost Basis proportionally", () => {
    const state = buildPortfolioState({
      openingSnapshots: [
        {
          id: "opening-danske",
          sourceAccountId: "danske",
          asOf: "2026-07-19T09:00:00.000Z",
          portfolioCash: { amount: "50.00", currency: "EUR" },
          positions: [
            {
              instrumentId: "bond-001",
              quantity: "10",
              currency: "EUR",
              costBasis: "800.00",
            },
          ],
        },
      ],
      events: [
        {
          id: "sale-001",
          type: "sale",
          sourceAccountId: "danske",
          instrumentId: "bond-001",
          asOf: "2026-07-20T09:00:00.000Z",
          quantity: "4",
          proceeds: { amount: "440.00", currency: "EUR" },
          fees: { amount: "2.00", currency: "EUR" },
        },
      ],
    });

    expect(state.positions).toEqual([
      {
        sourceAccountId: "danske",
        instrumentId: "bond-001",
        quantity: "6",
        currency: "EUR",
        costBasis: "480",
        reportedPriorReturn: "0",
      },
    ]);
    expect(state.cashBalances).toEqual([
      {
        sourceAccountId: "danske",
        currency: "EUR",
        amount: "488",
      },
    ]);
    expect(state.appliedEventIds).toEqual(["sale-001"]);
  });

  it("applies the same imported Portfolio Event only once", () => {
    const sale = {
      id: "provider-sale-42",
      type: "sale" as const,
      sourceAccountId: "trading-212",
      instrumentId: "stock-001",
      asOf: "2026-07-20T09:00:00.000Z",
      quantity: "4",
      proceeds: { amount: "440.00", currency: "EUR" },
    };

    const state = buildPortfolioState({
      openingSnapshots: [
        {
          id: "opening-trading-212",
          sourceAccountId: "trading-212",
          asOf: "2026-07-19T09:00:00.000Z",
          positions: [
            {
              instrumentId: "stock-001",
              quantity: "10",
              currency: "EUR",
              costBasis: "800.00",
            },
          ],
        },
      ],
      events: [sale, sale],
    });

    expect(state.positions[0]?.quantity).toBe("6");
    expect(state.cashBalances[0]?.amount).toBe("440");
    expect(state.appliedEventIds).toEqual(["provider-sale-42"]);
  });
});
