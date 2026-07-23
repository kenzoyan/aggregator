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
            instrumentId: "FIXTURE-FUND",
            displayName: "Synthetic Validation Fund",
            instrumentCode: "FIXTURE-FUND",
            assetType: "fund",
            quantity: "2",
            currency: "CNY",
            costBasis: "200",
            reportedPriorReturn: "25",
            averageCost: "100",
            observedPrice: "110",
            priceAsOf: "2026-07-20T00:00:00.000Z",
            reportedMarketValue: "225",
          }],
        },
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "draft" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Quantity × price is 220.00 CNY, but current value is 225.00 CNY.",
      fieldErrors: {
        "portfolio.holdings.0.observedPrice":
          "Quantity × price is 220.00 CNY, but current value is 225.00 CNY.",
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
            instrumentId: "FIXTURE-FUND",
            quantity: "2",
            currency: "CNY",
            costBasis: "200",
            reportedPriorReturn: "25",
            observedPrice: "110",
            reportedMarketValue: "220",
          }],
        },
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ id: "draft" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Cost basis + prior return is 225.00 CNY, but current value is 220.00 CNY.",
      fieldErrors: {
        "portfolio.holdings.0.reportedMarketValue":
          "Cost basis + prior return is 225.00 CNY, but current value is 220.00 CNY.",
      },
    });
  });
});
