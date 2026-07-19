import { describe, expect, it } from "vitest";

import { createCsvImportDraft } from "@/application/imports/csv-import";
import { createDashboardReadModel } from "@/application/portfolio-dashboard";
import { createPortfolioRepository } from "@/infrastructure/sqlite/portfolio-repository";

describe("CSV import confirmation workflow", () => {
  it("keeps a CSV draft separate, then displays its confirmed asset identity and value", () => {
    const repository = createPortfolioRepository(":memory:");
    const draft = createCsvImportDraft({
      draftId: "draft-csv",
      snapshotId: "snapshot-csv",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-19T10:00:00.000Z",
      csv: `source_account_id,instrument_name,instrument_code,asset_type,currency,quantity,nav,nav_date,average_cost,current_value,reported_profit,historical_cost_basis
alipay-main,Synthetic Index Fund,001234,fund,CNY,10,12.5,2026-07-16,10,125,25,100
`,
    });
    repository.createImportDraft(draft);

    expect(repository.getPortfolioState().positions).toEqual([]);

    repository.confirmImportDraft(draft.id, "2026-07-19T10:01:00.000Z");
    const state = repository.getPortfolioState();
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
      originalValue: "125 CNY",
      eurValue: 15.625,
    });
    repository.close();
  });
});
