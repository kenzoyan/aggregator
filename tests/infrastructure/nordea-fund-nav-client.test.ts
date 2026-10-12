import { describe, expect, it, vi } from "vitest";
import { NordeaFundNavClient } from "@/infrastructure/nordea/nordea-fund-nav-client";

export const syntheticNordeaFund = { ISIN: "FI4000010558", MediumName: "Nordea Eurooppa Indeksi Select B", BasisValuta: "EUR", LatestNAV: { "@Date": "2026-10-12T00:00:00+02:00", "#": "49.78447" } };
export function syntheticNordeaPage(fund: unknown = syntheticNordeaFund) {
  const data = JSON.stringify({ Fund: fund, Benchmark: { LatestNAV: { "@Date": "2026-10-09T00:00:00+02:00", "#": "5.33666" } }, PerformanceSeriesYTD: { Item: [{ Values: { Value: ["108.8"] } }] } }).replaceAll('"', '&quot;');
  return `<vue-chart-line :chart-data="${data}"></vue-chart-line>`;
}
const client = (html = syntheticNordeaPage()) => new NordeaFundNavClient({ today: () => "2026-10-12", fetch: vi.fn(async () => new Response(html)) });
describe("Nordea public latest NAV reader", () => {
  it("reads dated fund NAV, never benchmark or rebased performance", async () => {
    expect(await client().fetchSince("FI4000010558", "2026-10-01")).toEqual([{ instrumentCode: "FI4000010558", price: "49.78447", currency: "EUR", asOf: "2026-10-12", source: "nordea-funds" }]);
    expect(await client().fetchSince("FI4000010558", "2026-10-12")).toHaveLength(1);
  });
  it("does not fabricate historical rows when the NAV predates the requested window", async () => {
    const page = syntheticNordeaPage({ ...syntheticNordeaFund, LatestNAV: { "@Date": "2026-10-09T00:00:00+02:00", "#": "49" } });
    expect(await client(page).fetchSince("FI4000010558", "2026-10-10")).toEqual([]);
  });
  it.each([
    { ...syntheticNordeaFund, ISIN: "FI400001055B" },
    { ...syntheticNordeaFund, MediumName: "Nordea Eurooppa Indeksi Select A" },
    { ...syntheticNordeaFund, BasisValuta: "USD" },
    ...["2026-02-31T00:00:00+02:00", "2026-10-13T00:00:00+02:00", "2026-10-12", ""].map((date) => ({ ...syntheticNordeaFund, LatestNAV: { "@Date": date, "#": "49" } })),
    ...["0", "-1", "NaN", "49,78", "1e309"].map((price) => ({ ...syntheticNordeaFund, LatestNAV: { "@Date": syntheticNordeaFund.LatestNAV["@Date"], "#": price } })),
  ])("rejects unverified identity and invalid observations", async (fund) => {
    await expect(client(syntheticNordeaPage(fund)).fetchSince("FI4000010558", "2026-01-01")).rejects.toThrow();
  });
  it.each(["<html>No data</html>", syntheticNordeaPage()+syntheticNordeaPage(), '<vue-chart-line :chart-data="invalid"></vue-chart-line>'])("rejects missing, ambiguous or malformed data", async (page) => {
    await expect(client(page).fetchSince("FI4000010558", "2026-10-01")).rejects.toThrow();
  });
  it("uses only the fixed official route and fails closed on redirects and request failure", async () => {
    const fetch = vi.fn(async (url, options) => {
      expect(String(url)).toBe("https://www.nordeafunds.com/fi/rahastot/nordea-eurooppa-indeksi-select-b");
      expect(options?.redirect).toBe("error"); expect(options?.signal).toBeInstanceOf(AbortSignal);
      return new Response("failure", { status: 503 });
    });
    const reader = new NordeaFundNavClient({ fetch });
    await expect(reader.fetchSince("FI0000000000", "2026-10-01")).rejects.toThrow("Unsupported");
    expect(fetch).not.toHaveBeenCalled();
    await expect(reader.fetchSince("FI4000010558", "invalid")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await expect(reader.fetchSince("FI4000010558", "2026-10-01")).rejects.toThrow();
  });
  it("bounds the streamed page size", async () => {
    await expect(client('x'.repeat(2_000_001)).fetchSince("FI4000010558", "2026-10-01")).rejects.toThrow("safety limit");
  });
});
