import { z } from "zod";

import {
  assetTypeSchema,
  currencyCodeSchema,
  decimalStringSchema,
  positiveDecimalStringSchema,
} from "@/domain/portfolio/schemas";

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

export type CsvHolding = z.infer<typeof csvHoldingSchema>;

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

export function parseCsvHoldings(csv: string): CsvHolding[] {
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
