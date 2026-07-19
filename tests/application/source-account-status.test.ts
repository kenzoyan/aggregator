import { describe, expect, it } from "vitest";

import { createSourceAccountStatusReadModel } from "@/application/source-account-status";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import type { OpeningSnapshotInput } from "@/domain/portfolio/types";
import { sourceAccounts } from "@/domain/source-accounts";

function activePortfolio(snapshots: readonly OpeningSnapshotInput[]) {
  return {
    snapshots,
    state: buildPortfolioState({ openingSnapshots: snapshots, events: [] }),
  };
}

describe("source account status", () => {
  it("keeps every configured account visible and reports its latest confirmed snapshot", () => {
    const confirmedSnapshots = [
        {
          confirmedAt: "2026-06-01T09:00:00.000Z",
          snapshot: {
            id: "older",
            sourceAccountId: "alipay-main",
            asOf: "2026-06-01T08:00:00.000Z",
            positions: [{
              instrumentId: "fund-a",
              quantity: "1",
              currency: "CNY",
              costBasis: "100",
            }],
          },
        },
        {
          confirmedAt: "2026-07-19T07:00:00.000Z",
          snapshot: {
            id: "latest",
            sourceAccountId: "alipay-main",
            asOf: "2026-07-18T08:00:00.000Z",
            positions: [
              { instrumentId: "fund-a", quantity: "1", currency: "CNY", costBasis: "110" },
              { instrumentId: "fund-b", quantity: "1", currency: "CNY", costBasis: "90" },
            ],
          },
        },
      ];
    const statuses = createSourceAccountStatusReadModel({
      accounts: sourceAccounts,
      confirmedSnapshots,
      ...activePortfolio(confirmedSnapshots.map((record) => record.snapshot)),
      labels: { "alipay-main": "Long-term funds" },
      now: "2026-07-19T08:00:00.000Z",
    });

    expect(statuses).toHaveLength(4);
    expect(statuses[0]).toMatchObject({
      id: "alipay-main",
      label: "Long-term funds",
      status: "current",
      holdingCount: 2,
      lastUpdatedAt: "2026-07-19T07:00:00.000Z",
      dataAsOf: "2026-07-18T08:00:00.000Z",
      updateMethod: "Screenshot",
    });
    expect(statuses.find((account) => account.id === "trading212-main")).toMatchObject({
      status: "not-connected",
      holdingCount: 0,
      updateMethod: "Trading 212 API",
    });
  });

  it("uses a shorter freshness window for API accounts than screenshot accounts", () => {
    const confirmedSnapshots = [
      {
        confirmedAt: "2026-07-19T07:00:00.000Z",
        snapshot: {
          id: "alipay",
          sourceAccountId: "alipay-main",
          asOf: "2026-07-16T08:00:00.000Z",
          positions: [],
        },
      },
      {
        confirmedAt: "2026-07-19T07:00:00.000Z",
        snapshot: {
          id: "trading212",
          sourceAccountId: "trading212-main",
          asOf: "2026-07-16T08:00:00.000Z",
          positions: [],
        },
      },
    ];
    const statuses = createSourceAccountStatusReadModel({
      accounts: sourceAccounts,
      confirmedSnapshots,
      ...activePortfolio(confirmedSnapshots.map((record) => record.snapshot)),
      labels: {},
      now: "2026-07-19T08:00:00.000Z",
    });

    expect(statuses.find((account) => account.id === "alipay-main")?.status).toBe("current");
    expect(statuses.find((account) => account.id === "trading212-main")?.status).toBe("stale");
  });

  it("uses confirmation order when two snapshots have the same source timestamp", () => {
    const confirmedSnapshots = [
        {
          confirmedAt: "2026-07-19T07:00:00.000Z",
          snapshot: {
            id: "first",
            sourceAccountId: "danske-main",
            asOf: "2026-07-18T08:00:00.000Z",
            positions: [],
          },
        },
        {
          confirmedAt: "2026-07-19T07:05:00.000Z",
          snapshot: {
            id: "second",
            sourceAccountId: "danske-main",
            asOf: "2026-07-18T08:00:00.000Z",
            positions: [
              { instrumentId: "bond-a", quantity: "1", currency: "EUR", costBasis: "100" },
              { instrumentId: "bond-b", quantity: "1", currency: "EUR", costBasis: "100" },
            ],
          },
        },
      ];
    const statuses = createSourceAccountStatusReadModel({
      accounts: sourceAccounts,
      confirmedSnapshots,
      ...activePortfolio(confirmedSnapshots.map((record) => record.snapshot)),
      labels: {},
      now: "2026-07-19T08:00:00.000Z",
    });

    expect(statuses.find((account) => account.id === "danske-main")).toMatchObject({
      holdingCount: 2,
      lastUpdatedAt: "2026-07-19T07:05:00.000Z",
    });
  });

  it("keeps the newest source data active when an older screenshot is confirmed later", () => {
    const confirmedSnapshots = [
      {
        confirmedAt: "2026-07-19T07:00:00.000Z",
        snapshot: {
          id: "newer-data",
          sourceAccountId: "wechat-main",
          asOf: "2026-07-18T08:00:00.000Z",
          positions: [
            { instrumentId: "fund-a", quantity: "1", currency: "CNY", costBasis: "100" },
            { instrumentId: "fund-b", quantity: "1", currency: "CNY", costBasis: "100" },
          ],
        },
      },
      {
        confirmedAt: "2026-07-19T07:10:00.000Z",
        snapshot: {
          id: "older-data",
          sourceAccountId: "wechat-main",
          asOf: "2026-07-10T08:00:00.000Z",
          positions: [
            { instrumentId: "fund-a", quantity: "1", currency: "CNY", costBasis: "90" },
          ],
        },
      },
    ];
    const statuses = createSourceAccountStatusReadModel({
      accounts: sourceAccounts,
      confirmedSnapshots,
      ...activePortfolio(confirmedSnapshots.map((record) => record.snapshot)),
      labels: {},
      now: "2026-07-19T08:00:00.000Z",
    });

    expect(statuses.find((account) => account.id === "wechat-main")).toMatchObject({
      holdingCount: 2,
      lastUpdatedAt: "2026-07-19T07:10:00.000Z",
      dataAsOf: "2026-07-18T08:00:00.000Z",
    });
  });
});
