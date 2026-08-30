import { describe, expect, it } from "vitest";

import {
  draftPortfolioFromOpeningSnapshot,
  knownDraftValue,
  type ImportDraftInput,
} from "@/domain/imports";
import {
  applyImportDraftReview,
  createImportDraftReadModel,
} from "@/application/imports/import-draft-read-model";
import type { OpeningSnapshotInput } from "@/domain/portfolio/types";
import {
  createPortfolioDatabase,
  type PortfolioDatabase,
} from "@/infrastructure/sqlite/portfolio-repository";

function draft(input: {
  id: string;
  sourceAccountId: string;
  sourceKind: ImportDraftInput["sourceKind"];
  createdAt: string;
  snapshot: OpeningSnapshotInput;
}): ImportDraftInput {
  return {
    id: input.id,
    sourceAccountId: input.sourceAccountId,
    sourceKind: input.sourceKind,
    createdAt: input.createdAt,
    confidence: input.sourceKind === "manual" ? "manual" : "high",
    warnings: [],
    portfolio: draftPortfolioFromOpeningSnapshot(
      input.snapshot,
      input.sourceKind === "demo" ? "demo" : "manual",
    ),
  };
}

function confirm(
  database: PortfolioDatabase,
  importDraft: ImportDraftInput,
  confirmedAt: string,
) {
  return database.confirmImport({
    draftId: importDraft.id,
    confirmedImportId: `confirmed:${importDraft.id}`,
    confirmedAt,
    review: {
      confidence: importDraft.confidence,
      warnings: importDraft.warnings,
      portfolio: importDraft.portfolio,
    },
  });
}

describe("screenshot import confirmation workflow", () => {
  it("allows the demo review flow without adding synthetic holdings to the portfolio", () => {
    const database = createPortfolioDatabase(":memory:");
    const importDraft = draft({
      id: "draft-demo",
      sourceAccountId: "alipay-main",
      sourceKind: "demo",
      createdAt: "2026-07-19T10:00:00.000Z",
      snapshot: {
        id: "snapshot-demo",
        sourceAccountId: "alipay-main",
        asOf: "2026-07-19T10:00:00.000Z",
        positions: [{
          instrumentId: "Synthetic Example Fund",
          quantity: "1",
          currency: "CNY",
          costBasis: "100",
        }],
      },
    });
    database.saveImportDraft(importDraft);

    confirm(database, importDraft, "2026-07-19T10:01:00.000Z");

    expect(database.getImportDraft("draft-demo")?.status).toBe("confirmed");
    expect(database.readPortfolioFacts().openingSnapshots).toEqual([]);
    expect(database.readPortfolioFacts().state.positions).toEqual([]);
    database.close();
  });

  it("keeps an Import Draft out of the Tracked Portfolio until confirmation", () => {
    const database = createPortfolioDatabase(":memory:");
    const importDraft = draft({
      id: "draft-alipay-001",
      sourceAccountId: "alipay-main",
      sourceKind: "screenshot",
      createdAt: "2026-07-19T10:00:00.000Z",
      snapshot: {
        id: "opening-alipay-001",
        sourceAccountId: "alipay-main",
        asOf: "2026-07-19T09:00:00.000Z",
        positions: [{
          instrumentId: "fund-001",
          quantity: "10",
          currency: "CNY",
          costBasis: "800",
          reportedPriorReturn: "200",
        }],
      },
    });
    database.saveImportDraft(importDraft);
    expect(database.readPortfolioFacts().state.positions).toEqual([]);

    confirm(database, importDraft, "2026-07-19T10:05:00.000Z");
    confirm(database, importDraft, "2026-07-19T10:06:00.000Z");

    expect(database.readPortfolioFacts().state.positions).toEqual([
      {
        sourceAccountId: "alipay-main",
        instrumentId: "fund-001",
        quantity: "10",
        currency: "CNY",
        costBasis: "800",
        reportedPriorReturn: "200",
      },
    ]);
    expect(database.getImportDraft(importDraft.id)?.status).toBe("confirmed");
    expect(database.readPortfolioFacts().openingSnapshots[0]?.kind).toBe("opening");
    database.close();
  });

  it("uses the reviewed Import Draft values when confirming", () => {
    const database = createPortfolioDatabase(":memory:");
    const importDraft = draft({
      id: "draft-reviewed-001",
      sourceAccountId: "wechat-main",
      sourceKind: "screenshot",
      createdAt: "2026-07-19T10:00:00.000Z",
      snapshot: {
        id: "opening-wechat-001",
        sourceAccountId: "wechat-main",
        asOf: "2026-07-19T09:00:00.000Z",
        positions: [{
          instrumentId: "fund-002",
          quantity: "10",
          currency: "CNY",
          costBasis: "800",
        }],
      },
    });
    database.saveImportDraft(importDraft);
    const reviewedPortfolio = structuredClone(importDraft.portfolio);
    reviewedPortfolio.holdings[0]!.costBasis = knownDraftValue("750", "manual");

    database.confirmImport({
      draftId: importDraft.id,
      confirmedImportId: "confirmed-reviewed",
      confirmedAt: "2026-07-19T10:05:00.000Z",
      review: {
        confidence: "high",
        warnings: [],
        portfolio: reviewedPortfolio,
      },
    });

    expect(database.readPortfolioFacts().state.positions[0]?.costBasis).toBe("750");
    database.close();
  });

  it("persists a Trading 212 asset-type correction made during review", () => {
    const database = createPortfolioDatabase(":memory:");
    const importDraft = draft({
      id: "draft-trading212-etf",
      sourceAccountId: "trading212-main",
      sourceKind: "trading-212",
      createdAt: "2026-07-21T19:28:00.000Z",
      snapshot: {
        id: "opening-trading212-etf",
        sourceAccountId: "trading212-main",
        asOf: "2026-07-21T19:28:00.000Z",
        positions: [
          {
            instrumentId: "T212-ETF-FIXTURE",
            displayName: "Synthetic T212 ETF",
            instrumentCode: "T212-ETF-FIXTURE",
            assetType: "stock",
            quantity: "1",
            currency: "EUR",
            costBasis: "100",
          },
          {
            instrumentId: "REMOVED-BY-COMPLETE-SYNC",
            displayName: "Synthetic removed position",
            instrumentCode: "REMOVED-BY-COMPLETE-SYNC",
            assetType: "stock",
            quantity: "2",
            currency: "EUR",
            costBasis: "40",
          },
        ],
      },
    });
    database.saveImportDraft(importDraft);
    const editable = createImportDraftReadModel({
      ...importDraft,
      status: "draft",
    });
    editable.portfolio.holdings[0]!.assetType = "etf";

    database.confirmImport({
      draftId: importDraft.id,
      confirmedImportId: "confirmed-trading212-etf",
      confirmedAt: "2026-07-21T19:29:00.000Z",
      review: applyImportDraftReview(importDraft, editable),
    });

    expect(database.readPortfolioFacts().state.positions).toHaveLength(2);
    expect(database.readPortfolioFacts().state.positions[0]?.assetType).toBe("etf");

    const resync = draft({
      id: "draft-trading212-resync",
      sourceAccountId: "trading212-main",
      sourceKind: "trading-212",
      createdAt: "2026-07-22T19:28:00.000Z",
      snapshot: {
        id: "opening-trading212-resync",
        sourceAccountId: "trading212-main",
        asOf: "2026-07-22T19:28:00.000Z",
        positions: [{
          instrumentId: "T212-ETF-FIXTURE",
          displayName: "Synthetic T212 ETF",
          instrumentCode: "T212-ETF-FIXTURE",
          assetType: "stock",
          quantity: "1",
          currency: "EUR",
          costBasis: "100",
        }],
      },
    });
    database.saveImportDraft(resync);
    const savedResync = database.getImportDraft(resync.id)!;

    expect(createImportDraftReadModel(savedResync).portfolio.holdings[0]?.assetType)
      .toBe("etf");

    confirm(database, savedResync, "2026-07-22T19:29:00.000Z");
    expect(database.readPortfolioFacts().state.positions).toHaveLength(1);
    expect(
      database.readPortfolioFacts().openingSnapshots.map((snapshot) => snapshot.kind),
    ).toEqual(["opening", "holding-state"]);
    expect(database.readPortfolioFacts().state.positions[0]).toMatchObject({
      instrumentId: "T212-ETF-FIXTURE",
      assetType: "etf",
    });
    database.close();
  });

  it("uses the later confirmation when source timestamps are equal", () => {
    const database = createPortfolioDatabase(":memory:");
    const first = draft({
      id: "z-first-draft",
      sourceAccountId: "danske-main",
      sourceKind: "manual",
      createdAt: "2026-07-19T10:00:00.000Z",
      snapshot: {
        id: "z-first-snapshot",
        sourceAccountId: "danske-main",
        asOf: "2026-07-18T10:00:00.000Z",
        positions: [],
      },
    });
    const second = draft({
      id: "a-second-draft",
      sourceAccountId: "danske-main",
      sourceKind: "manual",
      createdAt: "2026-07-19T10:01:00.000Z",
      snapshot: {
        id: "a-second-snapshot",
        sourceAccountId: "danske-main",
        asOf: "2026-07-18T10:00:00.000Z",
        positions: [
          { instrumentId: "bond-a", quantity: "1", currency: "EUR", costBasis: "100" },
          { instrumentId: "bond-b", quantity: "1", currency: "EUR", costBasis: "100" },
        ],
      },
    });
    database.saveImportDraft(first);
    database.saveImportDraft(second);
    confirm(database, first, "2026-07-19T10:02:00.000Z");
    confirm(database, second, "2026-07-19T10:03:00.000Z");

    const data = database.readPortfolioFacts();
    expect(data.state.positions).toHaveLength(2);
    expect(data.confirmedSnapshots.at(-1)?.snapshot.id).toBe("a-second-snapshot");
    database.close();
  });

  it("reviews only screenshot holdings while preserving omitted confirmed holdings", () => {
    const database = createPortfolioDatabase(":memory:");
    const first = draft({
      id: "draft-screenshot-account",
      sourceAccountId: "alipay-main",
      sourceKind: "screenshot",
      createdAt: "2026-07-20T10:00:00.000Z",
      snapshot: {
        id: "snapshot-screenshot-account",
        sourceAccountId: "alipay-main",
        asOf: "2026-07-20T09:00:00.000Z",
        positions: [
          {
            instrumentId: "fund-a",
            quantity: "10",
            currency: "CNY",
            costBasis: "80",
            observedPrice: "10",
          },
          {
            instrumentId: "fund-b",
            quantity: "20",
            currency: "CNY",
            costBasis: "80",
            observedPrice: "5",
          },
        ],
      },
    });
    database.saveImportDraft(first);
    confirm(database, first, "2026-07-20T10:01:00.000Z");

    const update = draft({
      id: "draft-one-screenshot-holding",
      sourceAccountId: "alipay-main",
      sourceKind: "screenshot",
      createdAt: "2026-07-21T10:00:00.000Z",
      snapshot: {
        id: "snapshot-one-screenshot-holding",
        sourceAccountId: "alipay-main",
        asOf: "2026-07-21T09:00:00.000Z",
        positions: [{
          instrumentId: "fund-a",
          quantity: "10",
          currency: "CNY",
          costBasis: "80",
          observedPrice: "11",
        }],
      },
    });
    database.saveImportDraft(update);
    const savedUpdate = database.getImportDraft(update.id)!;

    expect(savedUpdate.portfolio.holdings).toHaveLength(1);
    expect(savedUpdate.portfolio.holdings[0]?.instrumentId).toMatchObject({
      value: "fund-a",
    });

    confirm(database, savedUpdate, "2026-07-21T10:01:00.000Z");
    expect(database.readPortfolioFacts().state.positions).toMatchObject([
      { instrumentId: "fund-a", observedPrice: "11" },
      { instrumentId: "fund-b", observedPrice: "5" },
    ]);
    database.close();
  });
});
