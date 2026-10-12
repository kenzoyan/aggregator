import { describe, expect, it } from "vitest";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";
import { VerifiedDanskeFundNavClient } from "@/infrastructure/danske-invest/verified-danske-fund-nav-client";
import { createPriceSourceService } from "@/application/price-source-service";
import { createAgentPriceSourceDiscovery } from "@/application/agent-price-source-discovery";
import { createAgentPriceSourceConfirmHandler } from "@/app/api/portfolio/analyst/price-source/handler";
import { createPortfolioAnalystConversation } from "@/application/portfolio-analyst-conversation";
import { createMarketDataRefresh } from "@/application/market-data-refresh";
import { createSourceAccountDefinition } from "@/domain/source-accounts";
import { bindingMatchesPosition } from "@/application/price-source-discovery";

export const syntheticDanskeIdentity = '<h1>Eurooppa Osake K</h1><span>ISIN: FI0008802988</span><table><tr><td>Perusvaluutta</td><td>EUR</td></tr></table>';
export const syntheticDanskeHistory = '<table><thead><tr><th>Pvm</td><th>Osuuden arvo</td></tr></thead><tbody><tr><td>09.10.2026</td><td>0,75781</td></tr><tr><td>12.10.2026</td><td>0,76128</td></tr></tbody></table>';

describe("Danske generic source binding", () => {
  it("prepares Agent review, explicitly confirms, and refreshes any account without changing assets", async () => {
    const db = createPortfolioDatabase(":memory:");
    try {
      const position = { sourceAccountId: "synthetic-broker", instrumentId: "fund", instrumentCode: "FI0008802988", displayName: "Synthetic European Equity", assetType: "fund" as const, currency: "EUR", quantity: "2", costBasis: "1", reportedPriorReturn: "0", observedPrice: "0.7", priceAsOf: "2026-10-06" };
      const database = { ...db, readSourceAccounts: () => [createSourceAccountDefinition({ id: position.sourceAccountId, accountType: "Example Broker" })], readPortfolioFacts: () => ({ state: { positions: [position], cashBalances: [], appliedEventIds: [] }, openingSnapshots: [] }) };
      const now = () => "2026-10-12T18:00:00Z";
      const provider = new VerifiedDanskeFundNavClient({ today: () => "2026-10-12", fetch: async (url) => new Response(String(url).includes("show_funds.product") ? syntheticDanskeIdentity : syntheticDanskeHistory) });
      const dependencies = { database, now, fundNavProvider: { id: "eastmoney", fetchSince: async () => { throw new Error("Wrong provider"); } }, priceSourceProviders: { "danske-invest": provider } };
      const service = createPriceSourceService(dependencies);
      const review = await createAgentPriceSourceDiscovery({ database, service, now, research: { search: async () => ({ findings: [], status: "completed", retrievedAt: now() }) } })({ sourceAccountId: position.sourceAccountId, instrumentId: position.instrumentId, language: "en" });
      expect(review).toMatchObject({ state: "verified", status: "pending", candidates: [{ price: "0.76128", priceAsOf: "2026-10-12" }] });
      expect(db.readPriceSourceBindings()).toEqual([]);
      const chat = createPortfolioAnalystConversation({ id: "synthetic-chat", provider: "openai", language: "en", includeHoldingNames: true, now: now() });
      chat.turns.push({ id: "turn", question: "Find source", createdAt: now(), chat: { assistantText: "Review source" }, priceSourceReview: review });
      db.savePortfolioAnalystConversation(chat);
      const response = await createAgentPriceSourceConfirmHandler({ database, service, now })(new Request("http://localhost/confirm", { method: "POST", body: JSON.stringify({ conversationId: chat.id, turnId: "turn", candidateId: review.candidates[0]!.id }) }));
      expect(response.status).toBe(200);
      expect(db.readMarketData().observations).toEqual([]);
      const binding = db.readPriceSourceBindings()[0]!;
      expect(binding.provider).toBe("danske-invest");
      expect(bindingMatchesPosition(binding, { ...position, instrumentCode: "FI0008802996" })).toBe(false);
      expect(bindingMatchesPosition(binding, { ...position, currency: "USD" })).toBe(false);
      expect(await createMarketDataRefresh(dependencies)("manual")).toMatchObject({ updated: 1, failed: [] });
      expect(db.readMarketData().observations.at(-1)).toMatchObject({ price: "0.76128", asOf: "2026-10-12", source: "danske-invest" });
      expect(database.readPortfolioFacts().state.positions).toEqual([position]);
      expect(db.readPriceSourceBindings()[0]!.lastRefresh).toMatchObject({ outcome: "updated", latestPriceAsOf: "2026-10-12" });
    } finally { db.close(); }
  });
});
