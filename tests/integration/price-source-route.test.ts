import { describe, expect, it } from "vitest";

import { createPriceSourceHandler } from "@/app/api/market-data/price-source/handler";
import type { PriceSourceBinding } from "@/application/price-source-discovery";
import { createSourceAccountDefinition } from "@/domain/source-accounts";

const sourceAccountId = "synthetic-wechat";
const instrumentId = "synthetic-fund";
const candidateId = "cmf-012414-eastmoney";

function fixture(quoteAvailable = true) {
  const account = createSourceAccountDefinition({ id: sourceAccountId, accountType: "微信" });
  const position = {
    sourceAccountId,
    instrumentId,
    displayName: "招商中证白酒指数C",
    instrumentCode: "unmatched-code",
    assetType: "fund" as const,
    quantity: "10",
    currency: "CNY",
    costBasis: "10",
    reportedPriorReturn: "0",
  };
  const bindings: PriceSourceBinding[] = [];
  const handler = createPriceSourceHandler({
    database: {
      readPortfolioFacts: () => ({ state: { positions: [position], cashBalances: [], appliedEventIds: [] } }),
      readSourceAccounts: () => [account],
      readPriceSourceBindings: () => bindings,
      savePriceSourceBinding: (binding) => { bindings.push(binding); },
    },
    fundNavProvider: {
      id: "eastmoney",
      fetchSince: async (code) => quoteAvailable
        ? [{ instrumentCode: code, price: "0.5", currency: "CNY", asOf: "2026-10-02", source: "eastmoney" }]
        : [],
    },
    now: () => "2026-10-04T09:00:00.000Z",
  });
  const lookup = () => handler.lookup(new Request(
    `http://localhost/api/market-data/price-source?sourceAccountId=${sourceAccountId}&instrumentId=${instrumentId}`,
  ));
  const confirm = (id = candidateId) => handler.confirm(new Request("http://localhost/api/market-data/price-source", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceAccountId, instrumentId, candidateId: id }),
  }));
  return { account, position, bindings, lookup, confirm };
}

describe("price source discovery and confirmation", () => {
  it("shows the candidate with a dated quote without binding it", async () => {
    const test = fixture();
    const response = await test.lookup();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      binding: null,
      candidates: [{
        id: candidateId,
        instrumentCode: "012414",
        currency: "CNY",
        shareClass: "C",
        priceAsOf: "2026-10-02",
        quoteAvailable: true,
      }],
    });
    expect(test.bindings).toEqual([]);
  });

  it("binds only the server-approved candidate after explicit confirmation", async () => {
    const test = fixture();
    expect((await test.confirm("other-fund")).status).toBe(409);
    expect(test.bindings).toEqual([]);
    const response = await test.confirm();
    expect(response.status).toBe(200);
    expect(test.bindings).toMatchObject([{
      instrumentCode: "012414",
      instrumentName: "招商中证白酒指数C",
      provider: "eastmoney",
    }]);
    expect(test.position.instrumentCode).toBe("unmatched-code");
    expect(await (await test.lookup()).json()).toMatchObject({
      candidates: [],
      binding: { instrumentCode: "012414" },
    });
  });

  it("does not bind when a recent NAV cannot be verified", async () => {
    const test = fixture(false);
    expect(await (await test.lookup()).json()).toMatchObject({
      candidates: [{ quoteAvailable: false }],
    });
    expect((await test.confirm()).status).toBe(503);
    expect(test.bindings).toEqual([]);
  });
});
