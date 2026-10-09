import Decimal from "decimal.js";
import { z } from "zod";
import { saleQuantityForDate } from "@/application/portfolio-sale-presentation";
import type { HoldingPriceHistoryReadModel } from "@/application/portfolio-read-model";

const decimal = z.string().max(80).regex(/^\d+(?:\.\d+)?$/);
export const saleScreenshotSchema = z.object({
  status: z.enum(["completed", "pending", "unknown", "multiple", "not-sale", "cancelled"]),
  accountName: z.string().max(120).nullable(),
  name: z.string().max(160).nullable(),
  symbol: z.string().max(100).nullable(),
  date: z.iso.date().nullable(),
  quantity: decimal.nullable(),
  gross: decimal.nullable(),
  net: decimal.nullable(),
  fees: decimal.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  destination: z.enum(["investment-account", "external-account"]).nullable(),
  destinationName: z.string().max(100).nullable(),
  warnings: z.array(z.string().max(250)).max(8),
}).strict();
export type SaleScreenshot = z.infer<typeof saleScreenshotSchema>;
export const saleDraftFieldsSchema = z.object({
  sourceAccountId: z.string().max(200), instrumentId: z.string().max(200),
  date: z.union([z.literal(""), z.iso.date()]),
  quantity: z.union([z.literal(""), decimal]),
  amount: z.union([z.literal(""), decimal]),
  amountType: z.enum(["gross", "net"]), fees: z.union([z.literal(""), decimal]),
  destination: z.enum(["", "investment-account", "external-account"]),
  destinationName: z.string().max(100),
}).strict();
export type SaleDraftFields = z.infer<typeof saleDraftFieldsSchema>;
export interface SaleDraftHolding {
  sourceAccountId: string; instrumentId: string; accountName: string;
  name: string; symbol?: string; currency: string; isFund: boolean;
  prices: HoldingPriceHistoryReadModel[];
}
export interface AgentSaleDraft {
  sourceTurnId: string;
  imageDigest: string;
  status: "pending" | "saved" | "cancelled";
  extraction: SaleScreenshot;
  fields: SaleDraftFields;
  eventId?: string;
}
const key = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
export function matchSaleHolding(extraction: SaleScreenshot, holdings: SaleDraftHolding[], accountId?: string) {
  const matches = holdings.filter((holding) =>
    (!accountId || holding.sourceAccountId === accountId) &&
    (!extraction.currency || extraction.currency === holding.currency) &&
    (extraction.symbol ? key(extraction.symbol) === key(holding.symbol ?? "")
      : Boolean(extraction.name && key(extraction.name) === key(holding.name))));
  return matches.length === 1 ? matches[0] : undefined;
}
export function saleDraftFields(extraction: SaleScreenshot, holding?: SaleDraftHolding): SaleDraftFields {
  return {
    sourceAccountId: holding?.sourceAccountId ?? "", instrumentId: holding?.instrumentId ?? "",
    date: extraction.date ?? "", quantity: extraction.quantity ?? "",
    amount: extraction.gross ?? extraction.net ?? "",
    amountType: extraction.gross !== null ? "gross" : "net", fees: extraction.fees ?? "",
    destination: extraction.destination ?? "", destinationName: extraction.destinationName ?? "",
  };
}
export function resolveSaleDraft(fields: SaleDraftFields, holding: SaleDraftHolding) {
  const parsed = saleDraftFieldsSchema.parse(fields);
  if (!parsed.amount || !parsed.fees) throw new Error("Enter the sale amount and fee. Confirm 0 if there was no fee.");
  const gross = parsed.amountType === "net" ? new Decimal(parsed.amount).plus(parsed.fees).toFixed() : parsed.amount;
  const resolved = saleQuantityForDate({
    amount: gross, date: parsed.date, currency: holding.currency,
    isFund: holding.isFund, prices: holding.prices, actualQuantity: parsed.quantity,
  });
  if (!resolved.quantity) throw new Error("Enter the actual quantity sold; no matching published NAV is saved for this date.");
  if (!parsed.destination) throw new Error("Choose where the sale proceeds went.");
  return {
    sale: {
      sourceAccountId: holding.sourceAccountId, instrumentId: holding.instrumentId,
      date: parsed.date, quantity: resolved.quantity, proceeds: gross, fees: parsed.fees,
      destination: parsed.destination === "external-account"
        ? { kind: "external-account" as const, name: parsed.destinationName }
        : { kind: "investment-account" as const },
    },
    estimatedQuantity: !parsed.quantity,
    nav: resolved.nav,
  };
}
