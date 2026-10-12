import { describe, expect, it, vi } from "vitest";
import { FinancialTimesFundNavClient } from "@/infrastructure/financial-times/financial-times-fund-nav-client";

// Synthetic HTML models the public table structure; no downloaded page or portfolio data.
export function fundPage(options: { isin?: string; currency?: string; date?: string; price?: string; name?: string } = {}) {
  const { isin = "FI4000439773", currency = "EUR", date = "Friday, October 09, 2026", price = "12.34", name = "OP-Europe Fund A" } = options;
  return `<div class="mod-tearsheet-overview__header__symbol"><span>${isin}:${currency}</span></div>
    <h1>${name}</h1><table class="mod-tearsheet-historical-prices__results mod-ui-table">
    <thead><tr><th>Date</th><th>Open</th><th>High</th><th>Low</th><th>Close</th><th>Volume</th></tr></thead>
    <tbody><tr><td><span class="mod-ui-hide-small-below">${date}</span><span>Fri, Oct 09, 2026</span></td>
    <td>99</td><td>100</td><td>98</td><td>${price}</td><td>0</td></tr></tbody></table>`;
}
function client(html = fundPage()) {
  const fetch = vi.fn(async (_url: RequestInfo | URL) => new Response(html));
  return { fetch, reader: new FinancialTimesFundNavClient({ fetch, today: () => "2026-10-12" }) };
}
describe("Financial Times fund NAV reader", () => {
  it("reads the exact EUR share class and closing price with its full valuation date", async () => {
    const { reader, fetch } = client();
    expect(await reader.fetchSince("FI4000439773", "2026-10-01")).toEqual([{
      instrumentCode: "FI4000439773", price: "12.34", currency: "EUR", asOf: "2026-10-09", source: "financial-times",
    }]);
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://markets.ft.com/data/funds/tearsheet/historical?s=FI4000439773%3AEUR");
  });
  it.each([
    { isin: "FI4000439774" }, { currency: "USD" }, { name: "OP-Europe Fund B" },
    { date: "October 09" }, { date: "Friday, February 30, 2026" },
    { date: "Friday, October 09, 2099" }, { price: "-1" }, { price: "NaN" }, { price: "0" }, { price: "12,34" },
  ])("rejects mismatched or invalid data %j", async (options) => {
    await expect(client(fundPage(options)).reader.fetchSince("FI4000439773", "2026-10-01")).rejects.toThrow();
  });
  it("reads English thousands separators without accepting decimal commas", async () => {
    expect(await client(fundPage({ price: "1,234.56" })).reader.fetchSince("FI4000439773", "2026-10-01"))
      .toMatchObject([{ price: "1234.56" }]);
  });
  it("limits the downloaded response size", async () => {
    await expect(client("x".repeat(1_000_001)).reader.fetchSince("FI4000439773", "2026-10-01")).rejects.toThrow("safety limit");
  });
  it("returns no newly dated rows without inventing a current-day NAV", async () => {
    expect(await client().reader.fetchSince("FI4000439773", "2026-10-10")).toEqual([]);
  });
  it("rejects an absent table and a changed column layout", async () => {
    for (const html of ["<h1>Unavailable</h1>", fundPage().replace("<th>Close</th>", "<th>Return</th>")]) {
      await expect(client(html).reader.fetchSince("FI4000439773", "2026-10-01")).rejects.toThrow();
    }
  });
  it("does not fetch arbitrary URLs or unverified ISINs", async () => {
    const { reader, fetch } = client();
    await expect(reader.fetchSince("https://localhost/private", "2026-10-01")).rejects.toThrow();
    await expect(reader.fetchSince("FI0000000000", "2026-10-01")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects an HTTP failure instead of parsing its body", async () => {
    const reader = new FinancialTimesFundNavClient({ fetch: async () => new Response(fundPage(), { status: 403 }) });
    await expect(reader.fetchSince("FI4000439773", "2026-10-01")).rejects.toThrow("request failed with 403");
  });
});
