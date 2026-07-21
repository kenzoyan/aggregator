import { describe, expect, it } from "vitest";

import { EastmoneyFundNavClient } from "@/infrastructure/eastmoney/eastmoney-fund-nav-client";

describe("Eastmoney fund NAV client", () => {
  it("returns published unit NAVs since the monitoring date", async () => {
    const client = new EastmoneyFundNavClient({
      fetch: async (input) => {
        expect(String(input)).toContain("fundCode=040046");
        const page = new URL(String(input)).searchParams.get("pageIndex");
        return Response.json({
          Data: {
            LSJZList: page === "1"
              ? [
                  { FSRQ: "2026-07-16", DWJZ: "8.1202", JZZZL: "-1.61" },
                  { FSRQ: "2026-07-15", DWJZ: "8.2530", JZZZL: "-0.41" },
                ]
              : [{ FSRQ: "2026-06-17", DWJZ: "7.9000", JZZZL: "0.10" }],
          },
          ErrCode: 0,
        });
      },
    });

    await expect(client.fetchSince("040046", "2026-07-16")).resolves.toEqual([
      {
        instrumentCode: "040046",
        price: "8.1202",
        currency: "CNY",
        asOf: "2026-07-16",
        dailyChangePercent: "-1.61",
        source: "eastmoney",
      },
    ]);
  });

  it("keeps paging until it reaches the monitoring date", async () => {
    const requestedPages: string[] = [];
    const client = new EastmoneyFundNavClient({
      fetch: async (input) => {
        const page = new URL(String(input)).searchParams.get("pageIndex") ?? "";
        requestedPages.push(page);
        const pageNumber = Number(page);
        const rows = pageNumber <= 2
          ? Array.from({ length: 20 }, (_, index) => ({
              FSRQ: new Date(Date.UTC(
                2026,
                6,
                31 - (((pageNumber - 1) * 20) + index),
              )).toISOString().slice(0, 10),
              DWJZ: "8.0000",
            }))
          : [{ FSRQ: "2026-06-21", DWJZ: "7.9000" }];
        return Response.json({ Data: { LSJZList: rows }, ErrCode: 0 });
      },
    });

    await client.fetchSince("040046", "2026-06-21");

    expect(requestedPages).toEqual(["1", "2", "3"]);
  });
});
