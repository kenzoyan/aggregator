import { describe, expect, it, vi } from "vitest";
import { createAgentPriceSourceDiscovery, type PriceSourceResearch } from "@/application/agent-price-source-discovery";
import { createPriceSourceService } from "@/application/price-source-service";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { createSourceAccountDefinition } from "@/domain/source-accounts";

const holding = { sourceAccountId: "synthetic-op", instrumentId: "fund-a", instrumentCode: "FI4000439773", displayName: "OP Europe", assetType: "fund" as const, currency: "EUR", quantity: "2", costBasis: "400", reportedPriorReturn: "0" };
const now = () => "2026-10-12T12:00:00Z";
function setup(position = holding) {
  const db = createPortfolioDatabase(":memory:");
  const database = { ...db, readPortfolioFacts: () => ({ state: { positions: [position], cashBalances: [], appliedEventIds: [] } }), readSourceAccounts: () => [createSourceAccountDefinition({ id: holding.sourceAccountId, accountType: "OP" })] };
  const service = createPriceSourceService({ database, now, fundNavProvider: { id: "eastmoney", fetchSince: async () => [] }, priceSourceProviders: { "financial-times": { id: "financial-times", fetchSince: async (code) => [{ instrumentCode: code, price: "224.79", asOf: "2026-10-09", currency: "EUR", source: "financial-times" }] } } });
  return { db, database, service };
}
describe("Agent price source discovery", () => {
  it("delegates only public identity, probes the registered source and does not activate it", async () => {
    const { db, database, service } = setup();
    try {
      const search = vi.fn(async (_input: Parameters<PriceSourceResearch["search"]>[0]) => ({ status: "completed" as const, retrievedAt: now(), findings: [{ title: "OP fund", url: "https://www.op.fi/fund", summary: "Fund identity" }] }));
      const discover = createAgentPriceSourceDiscovery({ database, service, research: { search }, now });
      const result = await discover({ sourceAccountId: holding.sourceAccountId, instrumentId: holding.instrumentId, language: "en" });
      expect(result).toMatchObject({ state: "verified", status: "pending", candidates: [{ price: "224.79", priceAsOf: "2026-10-09" }] });
      const query = search.mock.calls[0]![0];
      expect(query).toMatchObject({ isin: "FI4000439773", currency: "EUR", name: "OP Europe" });
      expect(query).not.toHaveProperty("quantity"); expect(query).not.toHaveProperty("costBasis"); expect(query).not.toHaveProperty("sourceAccountId");
      expect(db.readPriceSourceBindings()).toEqual([]); expect(db.readMarketData().observations).toEqual([]);
    } finally { db.close(); }
  });
  it("returns a saved source without repeating research", async () => {
    const { db, database, service } = setup();
    try {
      await service.confirm({ sourceAccountId: holding.sourceAccountId, instrumentId: holding.instrumentId, candidateId: "ft-FI4000439773-EUR" });
      const search = vi.fn();
      const result = await createAgentPriceSourceDiscovery({ database, service, research: { search }, now })({ ...holding, language: "en" });
      expect(result.state).toBe("already-confirmed"); expect(search).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
  it("keeps an unsupported Nordea page as research evidence without fetching arbitrary URLs", async () => {
    const { db, database, service } = setup({ ...holding, instrumentCode: "FI0000000000", displayName: "Synthetic Nordea" });
    try {
      const result = await createAgentPriceSourceDiscovery({ database, service, research: { search: async () => ({ status: "completed", retrievedAt: now(), findings: [{ title: "Synthetic Nordea fund", url: "https://www.nordea.fi/funds/example", summary: "Needs a supported reader" }] }) }, now })({ sourceAccountId: holding.sourceAccountId, instrumentId: holding.instrumentId, language: "en" });
      expect(result).toMatchObject({ state: "adapter-required", candidates: [], sources: [{ url: "https://www.nordea.fi/funds/example" }] });
      expect(db.readPriceSourceBindings()).toEqual([]);
    } finally { db.close(); }
  });
  it("rejects a holding that changes while its source is being probed", async () => {
    const { db, database, service } = setup();
    try {
      const original = service.lookup;
      service.lookup = async (args) => {
        const result = await original(args);
        database.readPortfolioFacts = () => ({ state: { positions: [{ ...holding, currency: "USD" }], cashBalances: [], appliedEventIds: [] } });
        return result;
      };
      const discover = createAgentPriceSourceDiscovery({ database, service, now, research: { search: async () => ({ findings: [], status: "completed", retrievedAt: now() }) } });
      await expect(discover({ sourceAccountId: holding.sourceAccountId, instrumentId: holding.instrumentId, language: "en" })).rejects.toThrow("holding changed");
      expect(db.readPriceSourceBindings()).toEqual([]);
    } finally { db.close(); }
  });

});
