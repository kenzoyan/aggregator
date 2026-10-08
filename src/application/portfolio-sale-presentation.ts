import Decimal from "decimal.js";

export function formatPortfolioSaleMoney(value: string, currency: string) {
  return `${new Decimal(value).toDecimalPlaces(2).toFixed(2)} ${currency}`;
}
