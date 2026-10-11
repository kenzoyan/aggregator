import { describe, expect, it, vi } from "vitest";
import { createPortfolioAnalysisHandler } from "@/app/api/portfolio/analysis/handler";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

describe("read-only full period analysis", () => {
  it("rejects unknown periods before reading financial records", async () => {
    const database = createPortfolioDatabase(":memory:");
    try {
      const read = vi.spyOn(database, "readPortfolioFacts");
      const handler = createPortfolioAnalysisHandler({ database });
      for (const period of ["", "year", "week' OR 1=1"]) {
        const response = await handler(new Request(`http://localhost/api/portfolio/analysis?period=${encodeURIComponent(period)}`));
        expect(response.status).toBe(400);
      }
      expect(read).not.toHaveBeenCalled();
    } finally { database.close(); }
  });

  it("returns an honest empty state without writing holdings or market data", async () => {
    const database = createPortfolioDatabase(":memory:");
    try {
      const beforeFacts = database.readPortfolioFacts();
      const beforeMarket = database.readMarketData();
      const record = vi.spyOn(database, "recordMarketData");
      const handler = createPortfolioAnalysisHandler({ database, now: () => "2026-10-11T12:00:00.000Z" });
      const response = await handler(new Request("http://localhost/api/portfolio/analysis?period=week"));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect((await response.json()).analysis).toMatchObject({ period: "week", available: false, coverage: "unavailable", holdings: [] });
      expect(record).not.toHaveBeenCalled();
      expect(database.readPortfolioFacts()).toEqual(beforeFacts);
      expect(database.readMarketData()).toEqual(beforeMarket);
    } finally { database.close(); }
  });

  it("keeps internal failures out of the public response", async () => {
    const database = createPortfolioDatabase(":memory:");
    try {
      vi.spyOn(database, "readPortfolioFacts").mockImplementation(() => { throw new Error("private record detail"); });
      const response = await createPortfolioAnalysisHandler({ database, logError: vi.fn() })(new Request("http://localhost/api/portfolio/analysis?period=today"));
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain("private record detail");
    } finally { database.close(); }
  });
});
