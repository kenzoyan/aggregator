import { describe, expect, it } from "vitest";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { NordeaFundNavClient } from "@/infrastructure/nordea/nordea-fund-nav-client";
import { createPriceSourceService } from "@/application/price-source-service";
import { createAgentPriceSourceDiscovery } from "@/application/agent-price-source-discovery";
import { createAgentPriceSourceConfirmHandler } from "@/app/api/portfolio/analyst/price-source/handler";
import { createPortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import { createMarketDataRefresh } from "@/application/market-data-refresh";
import { createSourceAccountDefinition } from "@/domain/source-accounts";
import { bindingMatchesPosition } from "@/application/price-source-discovery";

const syntheticPage = '<vue-chart-line :chart-data="{&quot;Fund&quot;:{&quot;ISIN&quot;:&quot;FI4000010558&quot;,&quot;MediumName&quot;:&quot;Nordea Eurooppa Indeksi Select B&quot;,&quot;BasisValuta&quot;:&quot;EUR&quot;,&quot;LatestNAV&quot;:{&quot;@Date&quot;:&quot;2026-10-12T00:00:00+02:00&quot;,&quot;#&quot;:&quot;49.78447&quot;}}}"></vue-chart-line>';

describe("Nordea generic source binding", () => {
  it("prepares Agent review, explicitly confirms, and refreshes any account without changing assets", async () => {
    const db = createPortfolioDatabase(":memory:");
    try {
      const position = { sourceAccountId: "synthetic-broker", instrumentId: "fund", instrumentCode: "FI4000010558", displayName: "Synthetic European Equity", assetType: "fund" as const, currency: "EUR", quantity: "2", costBasis: "1", reportedPriorReturn: "0", observedPrice: "0.7", priceAsOf: "2026-10-06" };
      const database = { ...db, readSourceAccounts: () => [createSourceAccountDefinition({ id: position.sourceAccountId, accountType: "Example Broker" })], readPortfolioFacts: () => ({ state: { positions: [position], cashBalances: [], appliedEventIds: [] }, openingSnapshots: [] }) };
      const now = () => "2026-10-12T18:00:00Z";
      let available = true;
      const provider = new NordeaFundNavClient({ today: () => "2026-10-12", fetch: async () => new Response(syntheticPage, { status: available ? 200 : 503 }) });
      const dependencies = { database, now, fundNavProvider: { id: "eastmoney", fetchSince: async () => { throw new Error("Wrong provider"); } }, priceSourceProviders: { "nordea-funds": provider } };
      const service = createPriceSourceService(dependencies);
      const review = await createAgentPriceSourceDiscovery({ database, service, now, research: { search: async () => ({ findings: [], status: "completed", retrievedAt: now() }) } })({ sourceAccountId: position.sourceAccountId, instrumentId: position.instrumentId, language: "en" });
      expect(review).toMatchObject({ state: "verified", status: "pending", coverage: "latest-only", candidates: [{ price: "49.78447", priceAsOf: "2026-10-12" }] });
      expect(db.readPriceSourceBindings()).toEqual([]);
      const chat = createPortfolioAnalystConversation({ id: "synthetic-chat", provider: "openai", language: "en", includeHoldingNames: true, now: now() });
      chat.turns.push({ id: "turn", question: "Find source", createdAt: now(), chat: { assistantText: "Review source" }, priceSourceReview: review });
      db.savePortfolioAnalystConversation(chat);
      const response = await createAgentPriceSourceConfirmHandler({ database, service, now })(new Request("http://localhost/confirm", { method: "POST", body: JSON.stringify({ conversationId: chat.id, turnId: "turn", candidateId: review.candidates[0]!.id }) }));
      expect(response.status).toBe(200);
      expect(db.readMarketData().observations).toEqual([]);
      const binding = db.readPriceSourceBindings()[0]!;
      expect(binding.provider).toBe("nordea-funds");
      expect(db.readPriceSourceBindings()).toHaveLength(1);
      expect(bindingMatchesPosition(binding, { ...position, instrumentCode: "FI4000010566" })).toBe(false);
      expect(bindingMatchesPosition(binding, { ...position, currency: "USD" })).toBe(false);
      expect(await createMarketDataRefresh(dependencies)("manual")).toMatchObject({ updated: 1, failed: [] });
      expect(db.readMarketData().observations.at(-1)).toMatchObject({ price: "49.78447", asOf: "2026-10-12", source: "nordea-funds" });
      expect(database.readPortfolioFacts().state.positions).toEqual([position]);
      expect(db.readPriceSourceBindings()[0]!.lastRefresh).toMatchObject({ outcome: "updated", latestPriceAsOf: "2026-10-12" });
      const observations = db.readMarketData().observations;
      available = false;
      const failed = await createMarketDataRefresh(dependencies)("manual");
      expect("failed" in failed && failed.failed).toHaveLength(1);
      expect(db.readMarketData().observations).toEqual(observations);
      expect(db.readPriceSourceBindings()[0]!.lastRefresh?.outcome).toBe("failed");
      expect(database.readPortfolioFacts().state.positions).toEqual([position]);
    } finally { db.close(); }
  });
});
