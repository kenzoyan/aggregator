import { describe, expect, it, vi } from "vitest";
import { VerifiedDanskeFundNavClient } from "@/infrastructure/danske-invest/verified-danske-fund-nav-client";
const identity = '<h1>Eurooppa Osake K</h1><span>ISIN: FI0008802988</span><table><tr><td>Perusvaluutta</td><td>EUR</td></tr></table>';
const history = (date = "12.10.2026", price = "0,76128") => `<table><thead><tr><th>Pvm</th><th>Osuuden arvo</th></tr></thead><tbody><tr><td>${date}</td><td>${price}</td></tr></tbody></table>`;
const client = (html = identity, rows = history()) => new VerifiedDanskeFundNavClient({ today: () => "2026-10-12", fetch: vi.fn(async (url) => new Response(String(url).includes('show_funds.product') ? html : rows)) });
describe("verified public Danske source", () => {
  it("reads an exact public ISIN and accumulation class without private route configuration", async () => {
    expect(await client().fetchSince("FI0008802988", "2026-10-01")).toEqual([{ instrumentCode: "FI0008802988", price: "0.76128", currency: "EUR", asOf: "2026-10-12", source: "danske-invest" }]);
  });
  it.each([identity.replace('FI0008802988', 'FI0008802996'), identity.replace('Osake K', 'Osake T'), identity.replace('EUR', 'USD')])("rejects a different identity/class/currency", async (html) => {
    await expect(client(html).fetchSince("FI0008802988", "2026-10-01")).rejects.toThrow(/identity|currency/);
  });
  it.each([history("31.02.2026"), history("13.10.2026"), history("12.10.2026", "0"), history("12.10.2026", "1.2.3"), history()+history(), history().replace('Osuuden arvo','Tuotto')])("rejects malformed or unsafe observations", async (rows) => {
    await expect(client(identity, rows).fetchSince("FI0008802988", "2026-01-01")).rejects.toThrow();
  });
  it("does not guess unknown ISINs or follow redirects", async () => {
    const fetch = vi.fn(async (_url, options) => { expect(options?.redirect).toBe("error"); return new Response(identity); });
    const reader = new VerifiedDanskeFundNavClient({ fetch });
    await expect(reader.fetchSince("FI0000000000", "2026-10-01")).rejects.toThrow("Unsupported");
    expect(fetch).not.toHaveBeenCalled();
    await expect(reader.fetchSince("FI0008802988", "2026-10-01")).rejects.toThrow();
  });
  it("bounds the streamed response size", async () => {
    const reader = new VerifiedDanskeFundNavClient({ fetch: async () => new Response('x'.repeat(1_000_001)) });
    await expect(reader.fetchSince("FI0008802988", "2026-10-01")).rejects.toThrow("safety limit");
  });
});
