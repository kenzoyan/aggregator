import { expect, it } from "vitest";

import { saleQuantityForDate, formatPortfolioSaleMoney, formatPortfolioSaleQuantity } from "@/application/portfolio-sale-presentation";

it("shows review amounts to cents without changing the stored precision", () => {
  expect(formatPortfolioSaleMoney("0.94413500223513634332", "CNY")).toBe("0.94 CNY");
  expect(formatPortfolioSaleMoney("-20.24586499776486365668", "CNY")).toBe("-20.25 CNY");
});

it("groups amounts and preserves fractional holding quantities without rounding units", () => {
  expect(formatPortfolioSaleMoney("1874.723", "CNY")).toBe("1,874.72 CNY");
  expect(formatPortfolioSaleQuantity("0.333333333333333333", 8)).toBe("0.33333333");
  expect(formatPortfolioSaleQuantity("4977.7600")).toBe("4,977.76");
  expect(formatPortfolioSaleQuantity("0.000000000000000001")).toBe("0.000000000000000001");
  expect(formatPortfolioSaleQuantity("12345678901234567890.123456789")).toBe("12,345,678,901,234,567,890.123456789");
});

it("only uses published fund NAV in the holding currency on the selected date", () => {
  const input = { amount: "1500", date: "2026-10-07", currency: "CNY", isFund: true, actualQuantity: "", prices: [
    { price: "0.75", currency: "CNY", asOf: "2026-10-07", source: "eastmoney" },
    { price: "0.9", currency: "CNY", asOf: "2026-10-06", source: "eastmoney" },
  ] };
  expect(saleQuantityForDate(input).quantity).toBe("2000");
  expect(saleQuantityForDate({ ...input, isFund: false }).quantity).toBeUndefined();
  expect(saleQuantityForDate({ ...input, date: "2026-10-08" }).quantity).toBeUndefined();
  expect(saleQuantityForDate({ ...input, currency: "EUR" }).quantity).toBeUndefined();
  for (const source of ["manual", "confirmed-snapshot", "trading212"]) {
    expect(saleQuantityForDate({ ...input, prices: [{ ...input.prices[0], source }] }).quantity).toBeUndefined();
  }
  expect(saleQuantityForDate({ ...input, prices: [{ ...input.prices[0], source: "danske-invest" }] }).quantity).toBe("2000");
});

it("prefers actual confirmed units and refuses invalid amounts or overrides", () => {
  const input = { amount: "1500", date: "2026-10-07", currency: "CNY", isFund: true, actualQuantity: "1999.99", prices: [
    { price: "0.75", currency: "CNY", asOf: "2026-10-07", source: "eastmoney" },
  ] };
  expect(saleQuantityForDate(input).quantity).toBe("1999.99");
  expect(saleQuantityForDate({ ...input, prices: [], isFund: false }).quantity).toBe("1999.99");
  for (const invalid of ["abc", "-1", "0", "Infinity"]) {
    expect(saleQuantityForDate({ ...input, actualQuantity: invalid }).quantity).toBeUndefined();
    expect(saleQuantityForDate({ ...input, amount: invalid }).quantity).toBeUndefined();
    expect(saleQuantityForDate({ ...input, actualQuantity: "", prices: [{ ...input.prices[0], price: invalid }] }).quantity).toBeUndefined();
  }
});
