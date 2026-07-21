import { describe, expect, it } from "vitest";

import { POST } from "@/app/api/imports/[id]/confirm/route";

describe("POST /api/imports/:id/confirm", () => {
  it("explains the exact inconsistent holding values instead of returning a generic 400", async () => {
    const request = new Request("http://localhost/api/imports/draft/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confidence: "high",
        warnings: [],
        portfolio: {
          snapshotId: "snapshot-second-day",
          asOf: "2026-07-21T00:00:00.000Z",
          holdings: [{
            lineId: "holding-1",
            instrumentId: "019172",
            displayName: "摩根纳斯达克100指数(QDII)A",
            instrumentCode: "019172",
            assetType: "fund",
            quantity: "3977.93",
            currency: "CNY",
            costBasis: "6360",
            reportedPriorReturn: "440.38",
            averageCost: "1.5938",
            observedPrice: "1.7045",
            priceAsOf: "2026-07-20T00:00:00.000Z",
            reportedMarketValue: "6800.38",
          }],
        },
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "draft" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Quantity × price is 6780.38 CNY, but current value is 6800.38 CNY.",
      fieldErrors: {
        "portfolio.holdings.0.observedPrice":
          "Quantity × price is 6780.38 CNY, but current value is 6800.38 CNY.",
      },
    });
  });

  it("explains the cost-basis mismatch after current value is corrected to quantity × price", async () => {
    const request = new Request("http://localhost/api/imports/draft/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confidence: "high",
        warnings: [],
        portfolio: {
          snapshotId: "snapshot-second-day",
          asOf: "2026-07-21T00:00:00.000Z",
          holdings: [{
            lineId: "holding-1",
            instrumentId: "019172",
            quantity: "3977.93",
            currency: "CNY",
            costBasis: "6360",
            reportedPriorReturn: "440.38",
            observedPrice: "1.7045",
            reportedMarketValue: "6780.38",
          }],
        },
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "draft" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Cost basis + prior return is 6800.38 CNY, but current value is 6780.38 CNY.",
      fieldErrors: {
        "portfolio.holdings.0.reportedMarketValue":
          "Cost basis + prior return is 6800.38 CNY, but current value is 6780.38 CNY.",
      },
    });
  });
});
