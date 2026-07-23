import { describe, expect, it } from "vitest";

import { createCsvImportDraft } from "@/application/imports/csv-import";
import { createDashboardReadModel } from "@/application/portfolio-dashboard";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

describe("CSV import confirmation workflow", () => {
  it("keeps a CSV draft separate, then displays its confirmed asset identity and value", () => {
    const database = createPortfolioDatabase(":memory:");
    const draft = createCsvImportDraft({
      draftId: "draft-csv",
      snapshotId: "snapshot-csv",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-19T10:00:00.000Z",
      csv: `source_account_id,instrument_name,instrument_code,asset_type,currency,quantity,nav,nav_date,average_cost,current_value,reported_profit,historical_cost_basis
alipay-main,Synthetic Index Fund,001234,fund,CNY,10,12.5,2026-07-16,10,125,25,100
`,
    });
    database.saveImportDraft(draft);

    expect(database.readPortfolioFacts().state.positions).toEqual([]);

    database.confirmImport({
      draftId: draft.id,
      confirmedImportId: "confirmed-csv",
      confirmedAt: "2026-07-19T10:01:00.000Z",
      review: {
        confidence: draft.confidence,
        warnings: draft.warnings,
        portfolio: draft.portfolio,
      },
    });
    const state = database.readPortfolioFacts().state;
    const dashboard = createDashboardReadModel({
      state,
      asOf: "2026-07-19T10:02:00.000Z",
      snapshotTimes: { "alipay-main": "2026-07-16T00:00:00.000Z" },
      eurPerUnit: { EUR: "1", CNY: "0.125" },
      fxAsOf: "2026-07-18",
    });

    expect(state.positions[0]).toMatchObject({
      instrumentId: "001234",
      displayName: "Synthetic Index Fund",
      instrumentCode: "001234",
      assetType: "fund",
      observedPrice: "12.5",
      reportedMarketValue: "125",
    });
    expect(dashboard.holdings[0]).toMatchObject({
      name: "Synthetic Index Fund",
      symbol: "001234",
      category: "Fund",
      originalValue: "125.00 CNY",
      eurValue: 15.625,
    });
    database.close();
  });

  it("keeps previously confirmed holdings when a later CSV updates only one holding", () => {
    const database = createPortfolioDatabase(":memory:");
    const first = createCsvImportDraft({
      draftId: "draft-first-account-state",
      snapshotId: "snapshot-first-account-state",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-20T10:00:00.000Z",
      csv: `source_account_id,instrument_name,instrument_code,asset_type,currency,quantity,nav,nav_date,average_cost,current_value,reported_profit,historical_cost_basis
alipay-main,Fund A,000001,fund,CNY,10,10,2026-07-20,8,100,20,80
alipay-main,Fund B,000002,fund,CNY,20,5,2026-07-20,4,100,20,80
`,
    });
    database.saveImportDraft(first);
    database.confirmImport({
      draftId: first.id,
      confirmedImportId: "confirmed-first-account-state",
      confirmedAt: "2026-07-20T10:01:00.000Z",
      review: {
        confidence: first.confidence,
        warnings: first.warnings,
        portfolio: first.portfolio,
      },
    });

    const partialUpdate = createCsvImportDraft({
      draftId: "draft-partial-update",
      snapshotId: "snapshot-partial-update",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-21T10:00:00.000Z",
      csv: `source_account_id,instrument_name,instrument_code,asset_type,currency,quantity,nav,nav_date,average_cost,current_value,reported_profit,historical_cost_basis
alipay-main,Fund A,000001,fund,CNY,10,11,2026-07-21,8,110,30,80
`,
    });
    database.saveImportDraft(partialUpdate);
    const savedPartialUpdate = database.getImportDraft(partialUpdate.id)!;
    expect(savedPartialUpdate.portfolio.holdings).toHaveLength(2);
    expect(savedPartialUpdate.warnings).toContain(
      "Previously confirmed holdings were included in this review. Removing one records that it is no longer held.",
    );
    database.confirmImport({
      draftId: partialUpdate.id,
      confirmedImportId: "confirmed-partial-update",
      confirmedAt: "2026-07-21T10:01:00.000Z",
      review: {
        confidence: savedPartialUpdate.confidence,
        warnings: savedPartialUpdate.warnings,
        portfolio: savedPartialUpdate.portfolio,
      },
    });

    expect(database.readPortfolioFacts().state.positions).toMatchObject([
      { instrumentId: "000001", observedPrice: "11" },
      { instrumentId: "000002", observedPrice: "5" },
    ]);

    const removal = createCsvImportDraft({
      draftId: "draft-explicit-removal",
      snapshotId: "snapshot-explicit-removal",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-22T10:00:00.000Z",
      csv: `source_account_id,instrument_name,instrument_code,asset_type,currency,quantity,nav,nav_date,average_cost,current_value,reported_profit,historical_cost_basis
alipay-main,Fund A,000001,fund,CNY,10,12,2026-07-22,8,120,40,80
`,
    });
    database.saveImportDraft(removal);
    const savedRemoval = database.getImportDraft(removal.id)!;
    expect(savedRemoval.portfolio.holdings).toHaveLength(2);
    database.confirmImport({
      draftId: removal.id,
      confirmedImportId: "confirmed-explicit-removal",
      confirmedAt: "2026-07-22T10:01:00.000Z",
      review: {
        confidence: savedRemoval.confidence,
        warnings: savedRemoval.warnings,
        portfolio: {
          ...savedRemoval.portfolio,
          holdings: savedRemoval.portfolio.holdings.filter(
            (holding) => holding.lineId === removal.portfolio.holdings[0]!.lineId,
          ),
        },
      },
    });
    expect(database.readPortfolioFacts().state.positions).toMatchObject([
      { instrumentId: "000001", observedPrice: "12" },
    ]);
    database.close();
  });
});
