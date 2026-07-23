import { describe, expect, it } from "vitest";

import {
  draftPortfolioFromOpeningSnapshot,
  prepareImportDraftForReview,
  reconcileImportDraft,
  restoreLegacyPartialSnapshots,
  materializeOpeningSnapshot,
  type DraftPortfolio,
  type ImportDraftInput,
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

  it("separates market observations from holding-state changes in a complete sync", () => {
    const draft: ImportDraftInput = {
      id: "draft-resync",
      sourceAccountId: "trading212-main",
      sourceKind: "trading-212",
      createdAt: "2026-07-21T12:00:00.000Z",
      confidence: "high",
      warnings: [],
      portfolio: draftPortfolioFromOpeningSnapshot({
        id: "snapshot-resync",
        sourceAccountId: "trading212-main",
        asOf: "2026-07-21T12:00:00.000Z",
        positions: [{
          instrumentId: "NEW_TICKER",
          displayName: "Synthetic ETF",
          instrumentCode: "IE00SYNTHETIC",
          quantity: "2.00",
          currency: "EUR",
          costBasis: "100.00",
          reportedPriorReturn: "12",
          observedPrice: "56",
          reportedMarketValue: "112",
        }],
      }, "api"),
    };
    const currentState = {
      positions: [{
        sourceAccountId: "trading212-main",
        instrumentId: "OLD_TICKER",
        displayName: "Synthetic ETF",
        instrumentCode: "IE00SYNTHETIC",
        assetType: "etf" as const,
        quantity: "2",
        currency: "EUR",
        costBasis: "100",
        reportedPriorReturn: "8",
      }],
      cashBalances: [],
      appliedEventIds: [],
    };

    const prepared = prepareImportDraftForReview(draft, currentState);

    expect(prepared.portfolio.reconciliation).toMatchObject({
      mode: "complete",
      snapshotKind: "holding-state",
      changeCount: 0,
      marketDataUpdatedCount: 1,
      holdings: [{
        kind: "market-data-updated",
        before: { instrumentId: "OLD_TICKER" },
        after: { instrumentId: "OLD_TICKER" },
        changes: [],
      }],
    });
    expect(prepared.portfolio.holdings[0]?.instrumentId).toMatchObject({
      value: "OLD_TICKER",
    });
    expect(prepared.portfolio.holdings[0]?.reportedPriorReturn).toMatchObject({
      value: "8",
    });
    expect(prepared.portfolio.holdings[0]?.assetType).toMatchObject({
      value: "etf",
    });

    expect(reconcileImportDraft(prepared, {
      ...currentState,
      positions: [{
        ...currentState.positions[0]!,
        observedPrice: "56",
        reportedMarketValue: "112",
      }],
    }).holdings[0]?.kind).toBe("unchanged");
  });

  it("marks changed, new and missing holdings for complete-snapshot review", () => {
    const draft: ImportDraftInput = {
      id: "draft-changes",
      sourceAccountId: "trading212-main",
      sourceKind: "trading-212",
      createdAt: "2026-07-22T12:00:00.000Z",
      confidence: "high",
      warnings: [],
      portfolio: draftPortfolioFromOpeningSnapshot({
        id: "snapshot-changes",
        sourceAccountId: "trading212-main",
        asOf: "2026-07-22T12:00:00.000Z",
        positions: [
          {
            instrumentId: "ETF-A",
            quantity: "3",
            currency: "EUR",
            costBasis: "160",
          },
          {
            instrumentId: "ETF-C",
            quantity: "1",
            currency: "EUR",
            costBasis: "25",
          },
        ],
      }, "api"),
    };

    const reconciliation = reconcileImportDraft(draft, {
      positions: [
        {
          sourceAccountId: "trading212-main",
          instrumentId: "ETF-A",
          quantity: "2",
          currency: "EUR",
          costBasis: "100",
          reportedPriorReturn: "0",
        },
        {
          sourceAccountId: "trading212-main",
          instrumentId: "ETF-B",
          quantity: "1",
          currency: "EUR",
          costBasis: "50",
          reportedPriorReturn: "0",
        },
      ],
      cashBalances: [],
      appliedEventIds: [],
    });

    expect(reconciliation.changeCount).toBe(3);
    expect(reconciliation.holdings).toEqual([
      expect.objectContaining({
        kind: "holding-changed",
        changes: [
          { field: "quantity", before: "2", after: "3" },
          { field: "costBasis", before: "100", after: "160" },
        ],
      }),
      expect.objectContaining({ kind: "new", after: { instrumentId: "ETF-C", quantity: "1", currency: "EUR", costBasis: "25" } }),
      expect.objectContaining({ kind: "possibly-removed", before: { instrumentId: "ETF-B", quantity: "1", currency: "EUR", costBasis: "50" } }),
    ]);
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
