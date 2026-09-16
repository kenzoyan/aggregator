import { describe, expect, it } from "vitest";

import {
  createMarketIntelligenceWindow,
  marketIntelligenceContentSchema,
  marketIntelligenceJsonSchema,
} from "@/application/market-intelligence";

describe("market intelligence", () => {
  it("creates an inclusive thirty-day window from the requested instant", () => {
    expect(createMarketIntelligenceWindow("2026-09-13T20:30:00.000Z"))
      .toEqual({ startDate: "2026-09-13", endDate: "2026-10-12" });
    expect(createMarketIntelligenceWindow("2026-09-13T22:30:00.000Z"))
      .toEqual({ startDate: "2026-09-14", endDate: "2026-10-13" });
  });

  it("rejects events outside the requested window and non-official sources", () => {
    const base = {
      windowStart: "2026-09-13",
      windowEnd: "2026-10-12",
      events: [{
        date: "2026-09-20",
        time: null,
        scheduledAt: null,
        region: "United States",
        category: "central-bank",
        title: "Policy decision",
        summary: "The policy-setting body is scheduled to publish its decision.",
        whyItMatters: "Interest-rate decisions can affect equity and currency valuations.",
        sources: [{ title: "Untrusted calendar", url: "https://example.com/calendar" }],
      }],
    };
    expect(() => marketIntelligenceContentSchema.parse(base)).toThrow();
    expect(() => marketIntelligenceContentSchema.parse({
      ...base,
      events: [{
        ...base.events[0],
        date: "2026-10-20",
        sources: [{ title: "Federal Reserve calendar", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" }],
      }],
    })).toThrow();
  });

  it("publishes the same field limits to the provider contract", () => {
    expect(marketIntelligenceJsonSchema).toMatchObject({
      properties: {
        events: {
          maxItems: 10,
          items: {
            properties: {
              region: { minLength: 1, maxLength: 80 },
              title: { minLength: 1, maxLength: 160 },
              summary: { minLength: 1, maxLength: 500 },
              whyItMatters: { minLength: 1, maxLength: 500 },
              sourceUrls: { minItems: 1, maxItems: 3 },
            },
          },
        },
      },
    });
  });
});
