import { describe, expect, it, vi } from "vitest";

import { DanskeInvestFundNavClient } from "@/infrastructure/danske-invest/danske-invest-fund-nav-client";

describe("Danske Invest fund NAV client", () => {
  const fundRoutes = {
    XX0000000001: { fund: "111", fundGroup: "222", siteId: "333" },
    XX0000000002: { fund: "444", fundGroup: "555", siteId: "666" },
  };

  it("returns official daily NAVs for a supported ISIN", async () => {
    const fetch = vi.fn(async () => new Response(`
      <table><tbody>
        <tr><td nowrap>01.09.2026</td><td class="tright" nowrap>6,08734</td></tr>
        <tr><td nowrap>03.09.2026</td><td class="tright" nowrap>6,16832</td></tr>
      </tbody></table>
    `));
    const client = new DanskeInvestFundNavClient({
      fetch,
      today: () => "2026-09-06",
      fundRoutes,
    });

    await expect(client.fetchSince("XX0000000001", "2026-09-02"))
      .resolves.toEqual([{
        instrumentCode: "XX0000000001",
        price: "6.16832",
        currency: "EUR",
        asOf: "2026-09-03",
        source: "danske-invest",
      }]);

    const [requestUrl] = fetch.mock.calls[0] as unknown as [RequestInfo | URL];
    const url = new URL(String(requestUrl));
    expect(url.hostname).toBe("www.danskeinvest.fi");
    expect(url.searchParams.get("p_nFund")).toBe("111");
    expect(url.searchParams.get("p_nFundgroup")).toBe("222");
    expect(url.searchParams.get("p_vDatoFra")).toBe("2026-09-02");
    expect(url.searchParams.get("p_vDatoTil")).toBe("2026-09-06");
    expect(url.searchParams.get("p_vFelter")).toBe("IV;");
  });

  it("routes the second supported Danske share class by ISIN", async () => {
    const fetch = vi.fn(async () => new Response(`
      <tr><td nowrap>04.09.2026</td><td class="tright" nowrap>16.859</td></tr>
    `));
    const client = new DanskeInvestFundNavClient({
      fetch,
      today: () => "2026-09-06",
      fundRoutes,
    });

    await expect(client.fetchSince("XX0000000002", "2026-09-01"))
      .resolves.toMatchObject([{ price: "16.859", asOf: "2026-09-04" }]);
    const [requestUrl] = fetch.mock.calls[0] as unknown as [RequestInfo | URL];
    const url = new URL(String(requestUrl));
    expect(url.searchParams.get("p_nFund")).toBe("444");
    expect(url.searchParams.get("p_nFundgroup")).toBe("555");
  });

  it("rejects unknown ISINs instead of guessing a fund", async () => {
    const client = new DanskeInvestFundNavClient({
      fetch: vi.fn(),
      today: () => "2026-09-06",
      fundRoutes,
    });

    await expect(client.fetchSince("FI0000000000", "2026-09-01"))
      .rejects.toThrow("Unsupported Danske Invest ISIN");
  });
});
