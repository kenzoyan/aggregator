import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPriceSourceHandler } from "@/app/api/market-data/price-source/handler";
import { createMarketDataRefresh } from "@/application/market-data-refresh";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createSourceAccountDefinition } from "@/domain/source-accounts";
import type { FundNavProvider } from "@/domain/market-data";
import type { Position } from "@/domain/portfolio/types";

const position: Position = { sourceAccountId: "synthetic-op", instrumentId: "fund-a", instrumentCode: "FI4000439773", displayName: "OP Europe", assetType: "fund", currency: "EUR", quantity: "2", costBasis: "20", reportedPriorReturn: "0", priceAsOf: "2026-10-06", observedPrice: "10" };
const candidateId = "ft-FI4000439773-EUR";
const now = () => "2026-10-12T09:00:00.000Z";
const account = createSourceAccountDefinition({ id: position.sourceAccountId, accountType: "OP" });
const fallback: FundNavProvider = { id: "eastmoney", fetchSince: async () => { throw new Error("Must not route EUR to Eastmoney"); } };
function facts(holding = position) { return { state: { positions: [holding], cashBalances: [], appliedEventIds: [] }, openingSnapshots: [] }; }
function request(method = "GET", id = candidateId) {
  return new Request(`http://localhost/api/market-data/price-source?sourceAccountId=${position.sourceAccountId}&instrumentId=${position.instrumentId}`, method === "GET" ? {} : { method, body: JSON.stringify({ sourceAccountId: position.sourceAccountId, instrumentId: position.instrumentId, candidateId: id }) });
}
function quoteProvider(price = "12", asOf = "2026-10-09"): FundNavProvider {
  return { id: "financial-times", supportsInstrumentCode: (code) => code === position.instrumentCode,
    fetchSince: async (code) => [{ instrumentCode: code, currency: "EUR", price, asOf, source: "financial-times" }] };
}

describe("confirmed FT fund price source", () => {
  it("requires confirmation, persists across restart and refreshes a generic account without search", async () => {
    const directory = mkdtempSync(join(tmpdir(), "synthetic-ft-source-"));
    const filename = join(directory, "portfolio.sqlite");
    let db = createPortfolioDatabase(filename);
    try {
      const provider = quoteProvider();
      const database = () => ({ ...db, readPortfolioFacts: () => facts(), readSourceAccounts: () => [account] });
      const refresh = () => createMarketDataRefresh({ database: database(), fundNavProvider: fallback, priceSourceProviders: { "financial-times": provider }, now });
      expect(await refresh()("automatic")).toMatchObject({ skipped: true, reason: "no-refreshable-positions" });
      const handler = createPriceSourceHandler({ database: database(), fundNavProvider: fallback, priceSourceProviders: { "financial-times": provider }, now });
      expect(await (await handler.lookup(request())).json()).toMatchObject({ binding: null, candidates: [{ id: candidateId, priceAsOf: "2026-10-09", quoteAvailable: true }] });
      expect(db.readPriceSourceBindings()).toEqual([]);
      expect((await handler.confirm(request("POST", "wrong-source"))).status).toBe(409);
      expect((await handler.confirm(request("POST"))).status).toBe(200);
      expect(db.readMarketData().observations).toEqual([]);
      expect(await refresh()("manual")).toMatchObject({ updated: 1, failed: [] });
      expect(db.readMarketData().observations).toMatchObject([{ price: "12", currency: "EUR", asOf: "2026-10-09", source: "financial-times" }]);
      db.close(); db = createPortfolioDatabase(filename);
      expect(db.readPriceSourceBindings()).toMatchObject([{ provider: "financial-times", lastRefresh: { outcome: "updated", latestPriceAsOf: "2026-10-09" } }]);
      expect(await refresh()("manual")).toMatchObject({ unchanged: 1, recordedPrices: 0 });
      expect(db.readMarketData().observations).toHaveLength(1);
      // Replacing an invalidated binding must not inherit an earlier instrument's status.
      db.savePriceSourceBinding({ ...db.readPriceSourceBindings()[0]!, instrumentName: "Different holding" });
      expect(db.readPriceSourceBindings()[0]?.lastRefresh).toBeUndefined();
      expect(facts().state.positions[0]).toEqual(position);
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  it("checks a newly confirmed source even if other prices were checked earlier that day", async () => {
    const db = createPortfolioDatabase(":memory:");
    try {
      const dependencies = { database: { ...db, readPortfolioFacts: () => facts(), readSourceAccounts: () => [account] }, fundNavProvider: fallback, priceSourceProviders: { "financial-times": quoteProvider() }, now };
      await createMarketDataRefresh(dependencies)("manual");
      await createPriceSourceHandler(dependencies).confirm(request("POST"));
      expect(await createMarketDataRefresh(dependencies)("automatic")).toMatchObject({ updated: 1, failed: [] });
      expect(await createMarketDataRefresh(dependencies)("automatic")).toMatchObject({ skipped: true, reason: "already-refreshed-today" });
    } finally { db.close(); }
  });
  it.each([["0", "2026-10-09"], ["12", "2026-02-30"], ["12", "2099-10-09"], ["12", "2026-08-01"]])("refuses invalid or old NAV %s / %s", async (price, asOf) => {
    const db = createPortfolioDatabase(":memory:");
    try {
      const handler = createPriceSourceHandler({ database: { ...db, readPortfolioFacts: () => facts(), readSourceAccounts: () => [account] }, fundNavProvider: fallback, priceSourceProviders: { "financial-times": quoteProvider(price, asOf) }, now });
      expect((await handler.confirm(request("POST"))).status).toBe(503);
      expect(db.readPriceSourceBindings()).toEqual([]);
    } finally { db.close(); }
  });
  it("rechecks holding identity after the provider awaits before saving", async () => {
    let holding = { ...position };
    const db = createPortfolioDatabase(":memory:");
    try {
      const provider = { ...quoteProvider(), fetchSince: async (code: string) => { holding = { ...holding, instrumentCode: "FI0000000000" }; return [{ instrumentCode: code, price: "12", asOf: "2026-10-09", currency: "EUR", source: "financial-times" }]; } };
      const handler = createPriceSourceHandler({ database: { ...db, readPortfolioFacts: () => facts(holding), readSourceAccounts: () => [account] }, fundNavProvider: fallback, priceSourceProviders: { "financial-times": provider }, now });
      expect((await handler.confirm(request("POST"))).status).toBe(409);
      expect(db.readPriceSourceBindings()).toEqual([]);
    } finally { db.close(); }
  });
  it("retains the last price on failure and rejects a saved binding after ISIN changes", async () => {
    const db = createPortfolioDatabase(":memory:");
    try {
      db.savePriceSourceBinding({ sourceAccountId: position.sourceAccountId, instrumentId: position.instrumentId, instrumentName: position.displayName!, instrumentCode: position.instrumentCode!, currency: "EUR", shareClass: "A (Accumulation)", provider: "financial-times", identityUrl: "https://markets.ft.com/data/funds/tearsheet/historical?s=FI4000439773:EUR", confirmedAt: now() });
      const fetchSince = vi.fn(quoteProvider().fetchSince);
      const make = (holding = position) => createMarketDataRefresh({ database: { ...db, readPortfolioFacts: () => facts(holding), readSourceAccounts: () => [account] }, fundNavProvider: fallback, priceSourceProviders: { "financial-times": { ...quoteProvider(), fetchSince } }, now });
      await make()("manual");
      fetchSince.mockRejectedValue(new Error("upstream timed out"));
      expect(await make()("manual")).toMatchObject({ failed: [{ category: "timeout" }], recordedPrices: 0 });
      expect(db.readMarketData().observations).toHaveLength(1);
      expect(db.readPriceSourceBindings()[0]?.lastRefresh).toMatchObject({ outcome: "failed", latestPriceAsOf: "2026-10-09" });
      fetchSince.mockClear();
      expect(await make({ ...position, instrumentCode: "FI0000000000" })("manual")).toMatchObject({ skipped: 1, updated: 0 });
      expect(fetchSince).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
});
