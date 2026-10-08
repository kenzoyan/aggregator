import Decimal from "decimal.js";
import type { HoldingPriceHistoryReadModel } from "@/application/portfolio-read-model";

export function saleQuantityForDate(input: {
  amount: string;
  date: string;
  currency: string;
  isFund: boolean;
  prices: readonly HoldingPriceHistoryReadModel[];
  actualQuantity: string;
}) {
  const nav = input.isFund ? input.prices.find((price) =>
    price.asOf === input.date && price.currency === input.currency &&
    ["eastmoney", "danske-invest"].includes(price.source) && positiveDecimal(price.price)
  ) : undefined;
  if (!positiveDecimal(input.amount)) return { nav, quantity: undefined };
  if (input.actualQuantity) {
    return { nav, quantity: positiveDecimal(input.actualQuantity) ? input.actualQuantity : undefined };
  }
  const PreciseDecimal = Decimal.clone({ precision: 40 });
  return { nav, quantity: nav ? new PreciseDecimal(input.amount).div(nav.price).toFixed() : undefined };
}

function positiveDecimal(value: string) {
  return /^\d+(?:\.\d+)?$/.test(value) && new Decimal(value).gt(0);
}

function groupDigits(value: string) {
  const [integer, fraction] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function formatPortfolioSaleMoney(value: string, currency: string) {
  return `${groupDigits(new Decimal(value).toDecimalPlaces(2).toFixed(2))} ${currency}`;
}

export function formatPortfolioSaleQuantity(value: string, decimalPlaces?: number) {
  const quantity = new Decimal(value);
  return groupDigits((decimalPlaces === undefined ? quantity : quantity.toDecimalPlaces(decimalPlaces)).toFixed());
}
