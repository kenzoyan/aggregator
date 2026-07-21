import Decimal from "decimal.js";
import { z } from "zod";

import {
  assetTypeSchema,
  currencyCodeSchema,
  decimalStringSchema,
  positiveDecimalStringSchema,
} from "@/domain/portfolio/schemas";
import {
  knownDraftValue,
  unknownDraftValue,
  type DraftHolding,
  type ImportDraftInput,
} from "@/domain/imports";

const requiredColumns = [
  "source_account_id",
  "instrument_name",
  "instrument_code",
  "asset_type",
  "currency",
  "quantity",
  "nav",
  "nav_date",
  "average_cost",
  "current_value",
  "reported_profit",
  "historical_cost_basis",
] as const;

const csvHoldingSchema = z.object({
  source_account_id: z.string().trim().min(1),
  instrument_name: z.string().trim().min(1),
  instrument_code: z.string().trim().min(1),
  asset_type: assetTypeSchema,
  currency: currencyCodeSchema,
  quantity: positiveDecimalStringSchema,
  nav: positiveDecimalStringSchema,
  nav_date: z.iso.date(),
  average_cost: positiveDecimalStringSchema,
  current_value: positiveDecimalStringSchema,
  reported_profit: decimalStringSchema,
  historical_cost_basis: positiveDecimalStringSchema,
});

type CsvHolding = z.infer<typeof csvHoldingSchema>;

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  row.push(value.replace(/\r$/, ""));
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

function parseHoldings(csv: string): CsvHolding[] {
  const rows = parseCsvRows(csv.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("CSV needs a header and at least one holding.");
  if (rows.length > 201) throw new Error("CSV cannot contain more than 200 holdings.");

  const headers = rows[0].map((header) => header.trim());
  const missing = requiredColumns.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required columns: ${missing.join(", ")}.`);
  }

  return rows.slice(1).map((values, index) => {
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
    const parsed = csvHoldingSchema.safeParse(record);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`CSV row ${index + 2} ${issue?.path.join(".") || "value"} ${issue?.message ?? "is invalid"}.`);
    }
    return parsed.data;
  });
}

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
  const holdings = parseHoldings(input.csv);
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
