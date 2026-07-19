import { describe, expect, it } from "vitest";

import { EcbFxClient } from "@/infrastructure/ecb/ecb-fx-client";

describe("ECB FX client", () => {
  it("converts ECB's currency-per-EUR quotes into EUR-per-currency rates", async () => {
    const xml = `<?xml version="1.0"?>
      <Cube><Cube time="2026-07-17">
        <Cube currency="USD" rate="1.1435"/>
        <Cube currency="CNY" rate="7.8012"/>
      </Cube></Cube>`;
    const client = new EcbFxClient({
      fetch: async () => new Response(xml, { status: 200 }),
    });

    const rates = await client.fetchLatestRates();

    expect(rates.asOf).toBe("2026-07-17");
    expect(rates.eurPerUnit.EUR).toBe("1");
    expect(Number(rates.eurPerUnit.USD)).toBeCloseTo(1 / 1.1435, 12);
    expect(Number(rates.eurPerUnit.CNY)).toBeCloseTo(1 / 7.8012, 12);
  });
});
