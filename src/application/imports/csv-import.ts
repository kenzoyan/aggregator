import Decimal from "decimal.js";

import {
  parseCsvHoldings,
  type CsvHolding,
} from "@/application/imports/csv-holdings-parser";
import {
  knownDraftValue,
  unknownDraftValue,
  type DraftHolding,
  type ImportDraftInput,
} from "@/domain/imports";

function assertReconciles(holding: CsvHolding, rowNumber: number) {
  const currentValue = new Decimal(holding.current_value);
  const navValue = new Decimal(holding.quantity).mul(holding.nav);
  if (navValue.minus(currentValue).abs().gt("0.02")) {
    throw new Error(`CSV row ${rowNumber} quantity × NAV does not match current value.`);
  }

  const accountedValue = new Decimal(holding.historical_cost_basis).plus(holding.reported_profit);
  if (accountedValue.minus(currentValue).abs().gt("0.02")) {
    throw new Error(`CSV row ${rowNumber} cost basis + prior return does not match current value.`);
  }
}

export function createCsvImportDraft(input: {
  draftId: string;
  snapshotId: string;
  sourceAccountId: string;
  createdAt: string;
  csv: string;
}): ImportDraftInput {
  const holdings = parseCsvHoldings(input.csv);
  const seenIds = new Set<string>();

  const draftHoldings: DraftHolding[] = holdings.map((holding, index) => {
    if (holding.source_account_id !== input.sourceAccountId) {
      throw new Error(`CSV row ${index + 2} belongs to ${holding.source_account_id}, not ${input.sourceAccountId}.`);
    }
    if (seenIds.has(holding.instrument_code)) {
      throw new Error(`CSV contains duplicate instrument code ${holding.instrument_code}.`);
    }
    seenIds.add(holding.instrument_code);
    assertReconciles(holding, index + 2);

    return {
      lineId: `${input.draftId}:line:${index + 1}`,
      instrumentId: knownDraftValue(holding.instrument_code, "csv"),
      displayName: knownDraftValue(holding.instrument_name, "csv"),
      instrumentCode: knownDraftValue(holding.instrument_code, "csv"),
      assetType: knownDraftValue(holding.asset_type, "csv"),
      quantity: knownDraftValue(new Decimal(holding.quantity).toString(), "csv"),
      currency: knownDraftValue(holding.currency.toUpperCase(), "csv"),
      costBasis: knownDraftValue(
        new Decimal(holding.historical_cost_basis).toString(),
        "csv",
      ),
      reportedPriorReturn: knownDraftValue(
        new Decimal(holding.reported_profit).toString(),
        "csv",
      ),
      averageCost: knownDraftValue(
        new Decimal(holding.average_cost).toString(),
        "csv",
      ),
      observedPrice: knownDraftValue(new Decimal(holding.nav).toString(), "csv"),
      priceAsOf: knownDraftValue(`${holding.nav_date}T00:00:00.000Z`, "csv"),
      priceSource: knownDraftValue("confirmed-csv", "csv"),
      reportedMarketValue: knownDraftValue(
        new Decimal(holding.current_value).toString(),
        "csv",
      ),
    };
  });

  return {
    id: input.draftId,
    sourceAccountId: input.sourceAccountId,
    sourceKind: "csv",
    createdAt: input.createdAt,
    confidence: "high",
    warnings: [
      "CSV import excludes pending transactions. Review all holdings before confirmation.",
    ],
    portfolio: {
      snapshotId: input.snapshotId,
      asOf: knownDraftValue(input.createdAt, "csv"),
      portfolioCash: unknownDraftValue(),
      holdings: draftHoldings,
    },
  };
}
