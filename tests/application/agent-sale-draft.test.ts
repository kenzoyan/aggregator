import { expect, it } from "vitest";
import { matchSaleHolding, resolveSaleDraft, saleDraftFields, saleScreenshotSchema, type SaleDraftHolding } from "@/application/agent-sale-draft";
const extraction = saleScreenshotSchema.parse({
  status: "completed", accountName: null, name: "Fund", symbol: "123", date: "2026-01-02",
  quantity: "2", gross: null, net: "29", fees: "1", currency: "EUR",
  destination: "external-account", destinationName: "Bank", warnings: [],
});
const holding: SaleDraftHolding = { sourceAccountId: "a", instrumentId: "f", accountName: "Test", name: "Fund", symbol: "123", currency: "EUR", isFund: true, prices: [] };
it("converts net to gross once and uses actual screenshot units", () => {
  const result = resolveSaleDraft(saleDraftFields(extraction, holding), holding);
  expect(result.sale).toMatchObject({ proceeds: "30", fees: "1", quantity: "2" });
  expect(result.estimatedQuantity).toBe(false);
});
it("requires missing fee and destination confirmation instead of guessing", () => {
  const fields = saleDraftFields({ ...extraction, fees: null, destination: null }, holding);
  expect(() => resolveSaleDraft(fields, holding)).toThrow("fee");
  expect(() => resolveSaleDraft({ ...fields, fees: "0" }, holding)).toThrow("where");
});
it("does not guess between accounts or mismatch currencies", () => {
  expect(matchSaleHolding(extraction, [holding, { ...holding, sourceAccountId: "b" }])).toBeUndefined();
  expect(matchSaleHolding(extraction, [holding, { ...holding, sourceAccountId: "b" }], "a")).toEqual(holding);
  expect(matchSaleHolding({ ...extraction, currency: "CNY" }, [holding])).toBeUndefined();
});
it("only estimates fund units from an exact dated published NAV", () => {
  const fields = { ...saleDraftFields(extraction, holding), quantity: "" };
  expect(() => resolveSaleDraft(fields, holding)).toThrow("actual quantity");
  const withNav = { ...holding, prices: [{ asOf: "2026-01-02", price: "15", currency: "EUR", source: "eastmoney" }] };
  expect(resolveSaleDraft(fields, withNav).sale.quantity).toBe("2");
  expect(resolveSaleDraft(fields, withNav).estimatedQuantity).toBe(true);
});
