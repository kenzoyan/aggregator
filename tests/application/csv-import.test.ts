import { describe, expect, it } from "vitest";

import { createCsvImportDraft } from "@/application/imports/csv-import";
import { materializeOpeningSnapshot } from "@/domain/imports";

const csv = `source_account_id,instrument_name,instrument_code,asset_type,currency,quantity,nav,nav_date,average_cost,current_value,reported_profit,reported_return_percent,daily_nav_change_percent,historical_cost_basis
alipay-main,"Synthetic, Global Fund",001234,fund,CNY,10,12.5,2026-07-16,10,125,25,25,-1.5,100
alipay-main,Synthetic Bond Fund,567890,bond,CNY,20,5,2026-07-15,4.5,100,10,11.11,0.2,90
`;

describe("CSV import seam", () => {
  it("creates a review draft with stable identifiers, NAV and prior return", () => {
    const draft = createCsvImportDraft({
      draftId: "draft-csv",
      snapshotId: "snapshot-csv",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-19T10:00:00.000Z",
      csv,
    });

    expect(draft).toMatchObject({
      sourceAccountId: "alipay-main",
      sourceKind: "csv",
      confidence: "high",
      portfolio: {
        asOf: {
          status: "known",
          value: "2026-07-19T10:00:00.000Z",
          source: "csv",
        },
      },
    });
    expect(draft.portfolio.holdings).toHaveLength(2);
    expect(
      materializeOpeningSnapshot(draft.sourceAccountId, draft.portfolio)
        .positions[0],
    ).toEqual({
      instrumentId: "001234",
      displayName: "Synthetic, Global Fund",
      instrumentCode: "001234",
      assetType: "fund",
      quantity: "10",
      currency: "CNY",
      costBasis: "100",
      reportedPriorReturn: "25",
      averageCost: "10",
      observedPrice: "12.5",
      priceAsOf: "2026-07-16T00:00:00.000Z",
      priceSource: "confirmed-csv",
      reportedMarketValue: "125",
    });
  });

  it("rejects a row whose NAV does not reconcile to its current holding value", () => {
    expect(() => createCsvImportDraft({
      draftId: "draft-csv",
      snapshotId: "snapshot-csv",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-19T10:00:00.000Z",
      csv: csv.replace("10,12.5", "10,99"),
    })).toThrow("quantity × NAV does not match current value");
  });

  it("rejects a file for another Source Account", () => {
    expect(() => createCsvImportDraft({
      draftId: "draft-csv",
      snapshotId: "snapshot-csv",
      sourceAccountId: "wechat-main",
      createdAt: "2026-07-19T10:00:00.000Z",
      csv,
    })).toThrow("belongs to alipay-main, not wechat-main");
  });

  it("reports malformed quoting and missing required columns precisely", () => {
    expect(() => createCsvImportDraft({
      draftId: "draft-csv",
      snapshotId: "snapshot-csv",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-19T10:00:00.000Z",
      csv: `${csv}\n"unclosed`,
    })).toThrow("CSV contains an unclosed quoted field.");

    expect(() => createCsvImportDraft({
      draftId: "draft-csv",
      snapshotId: "snapshot-csv",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-19T10:00:00.000Z",
      csv: "source_account_id,instrument_name\nalipay-main,Synthetic Fund",
    })).toThrow(
      "CSV is missing required columns: instrument_code, asset_type, currency, quantity, nav, nav_date, average_cost, current_value, reported_profit, historical_cost_basis.",
    );
  });

  it("rejects duplicate instrument codes", () => {
    const duplicate = `${csv.trim()}\nalipay-main,Duplicate Fund,001234,fund,CNY,10,12.5,2026-07-16,10,125,25,25,-1.5,100\n`;

    expect(() => createCsvImportDraft({
      draftId: "draft-csv",
      snapshotId: "snapshot-csv",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-19T10:00:00.000Z",
      csv: duplicate,
    })).toThrow("CSV contains duplicate instrument code 001234.");
  });

  it("rejects cost basis and prior return that do not reconcile", () => {
    expect(() => createCsvImportDraft({
      draftId: "draft-csv",
      snapshotId: "snapshot-csv",
      sourceAccountId: "alipay-main",
      createdAt: "2026-07-19T10:00:00.000Z",
      csv: csv.replace("125,25,25", "125,20,25"),
    })).toThrow("CSV row 2 cost basis + prior return does not match current value.");
  });
});
