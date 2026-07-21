import { describe, expect, it } from "vitest";

import {
  restoreLegacyPartialSnapshots,
  materializeOpeningSnapshot,
  type DraftPortfolio,
} from "@/domain/imports";

describe("Import Draft materialization", () => {
  it("keeps uncertainty in the draft and emits only confirmed portfolio facts", () => {
    const draft: DraftPortfolio = {
      snapshotId: "snapshot-1",
      asOf: {
        status: "known",
        value: "2026-07-21T10:00:00.000Z",
        source: "api",
      },
      portfolioCash: { status: "unknown" },
      holdings: [
        {
          lineId: "line-1",
          instrumentId: {
            status: "known",
            value: "001234",
            source: "csv",
          },
          displayName: { status: "unknown" },
          instrumentCode: {
            status: "known",
            value: "001234",
            source: "csv",
          },
          assetType: {
            status: "known",
            value: "fund",
            source: "csv",
          },
          quantity: {
            status: "known",
            value: "10",
            source: "csv",
          },
          currency: {
            status: "known",
            value: "CNY",
            source: "csv",
          },
          costBasis: {
            status: "inferred",
            value: "100",
            reason: "Current value minus reported prior return",
          },
          reportedPriorReturn: {
            status: "known",
            value: "25",
            source: "csv",
          },
          averageCost: { status: "unknown" },
          observedPrice: {
            status: "known",
            value: "12.5",
            source: "csv",
          },
          priceAsOf: {
            status: "known",
            value: "2026-07-20T00:00:00.000Z",
            source: "csv",
          },
          priceSource: {
            status: "known",
            value: "confirmed-csv",
            source: "csv",
          },
          reportedMarketValue: {
            status: "known",
            value: "125",
            source: "csv",
          },
        },
      ],
    };

    expect(materializeOpeningSnapshot("alipay-main", draft)).toEqual({
      id: "snapshot-1",
      sourceAccountId: "alipay-main",
      asOf: "2026-07-21T10:00:00.000Z",
      positions: [
        {
          instrumentId: "001234",
          instrumentCode: "001234",
          assetType: "fund",
          quantity: "10",
          currency: "CNY",
          costBasis: "100",
          reportedPriorReturn: "25",
          observedPrice: "12.5",
          priceAsOf: "2026-07-20T00:00:00.000Z",
          priceSource: "confirmed-csv",
          reportedMarketValue: "125",
        },
      ],
    });
  });

  it("rejects confirmation while a required portfolio fact is unknown", () => {
    const draft: DraftPortfolio = {
      snapshotId: "snapshot-1",
      asOf: {
        status: "known",
        value: "2026-07-21T10:00:00.000Z",
        source: "manual",
      },
      portfolioCash: { status: "unknown" },
      holdings: [
        {
          lineId: "line-1",
          instrumentId: { status: "unknown" },
          displayName: { status: "unknown" },
          instrumentCode: { status: "unknown" },
          assetType: { status: "unknown" },
          quantity: { status: "unknown" },
          currency: { status: "unknown" },
          costBasis: { status: "unknown" },
          reportedPriorReturn: { status: "unknown" },
          averageCost: { status: "unknown" },
          observedPrice: { status: "unknown" },
          priceAsOf: { status: "unknown" },
          priceSource: { status: "unknown" },
          reportedMarketValue: { status: "unknown" },
        },
      ],
    };

    expect(() => materializeOpeningSnapshot("alipay-main", draft)).toThrow(
      "Holding 1 instrumentId is still unknown",
    );
  });

  it("restores omitted holdings from legacy partial imports without merging complete API snapshots", () => {
    const restored = restoreLegacyPartialSnapshots([
      {
        sourceKind: "csv",
        warnings: [],
        snapshot: {
          id: "alipay-before",
          sourceAccountId: "alipay-main",
          asOf: "2026-07-20T10:00:00.000Z",
          positions: [
            { instrumentId: "fund-a", quantity: "1", currency: "CNY", costBasis: "10" },
            { instrumentId: "fund-b", quantity: "1", currency: "CNY", costBasis: "20" },
          ],
        },
      },
      {
        sourceKind: "csv",
        warnings: ["CSV import excludes pending transactions."],
        snapshot: {
          id: "alipay-legacy-partial",
          sourceAccountId: "alipay-main",
          asOf: "2026-07-21T10:00:00.000Z",
          positions: [
            { instrumentId: "fund-a", quantity: "1", currency: "CNY", costBasis: "11" },
          ],
        },
      },
      {
        sourceKind: "trading-212",
        warnings: [],
        snapshot: {
          id: "trading-before",
          sourceAccountId: "trading212-main",
          asOf: "2026-07-20T10:00:00.000Z",
          positions: [
            { instrumentId: "etf-a", quantity: "1", currency: "EUR", costBasis: "100" },
            { instrumentId: "etf-b", quantity: "1", currency: "EUR", costBasis: "100" },
          ],
        },
      },
      {
        sourceKind: "trading-212",
        warnings: [],
        snapshot: {
          id: "trading-complete-update",
          sourceAccountId: "trading212-main",
          asOf: "2026-07-21T10:00:00.000Z",
          positions: [
            { instrumentId: "etf-a", quantity: "1", currency: "EUR", costBasis: "100" },
          ],
        },
      },
    ]);

    expect(restored[1]?.positions.map((position) => position.instrumentId))
      .toEqual(["fund-a", "fund-b"]);
    expect(restored[3]?.positions.map((position) => position.instrumentId))
      .toEqual(["etf-a"]);
  });
});
