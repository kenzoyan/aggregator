import { describe, expect, it } from "vitest";

import { applyConfirmedPriceSources, bindingMatchesPosition, discoverPriceSourceCandidates } from "@/application/price-source-discovery";
import type { Position } from "@/domain/portfolio/types";

const position: Position = {
  sourceAccountId: "synthetic-wechat",
  instrumentId: "synthetic-holding",
  displayName: "招商中证白酒指数C",
  instrumentCode: "unmatched-code",
  assetType: "fund",
  quantity: "1",
  currency: "CNY",
  costBasis: "1",
  reportedPriorReturn: "0",
};

describe("price source discovery pilot", () => {
  it("offers the verified C share class only for the unmatched WeChat fund", () => {
    expect(discoverPriceSourceCandidates(position, "wechat")).toMatchObject([{
      instrumentCode: "012414",
      currency: "CNY",
      shareClass: "C",
      provider: "eastmoney",
    }]);
    expect(discoverPriceSourceCandidates({ ...position, currency: "EUR" }, "wechat")).toEqual([]);
    expect(discoverPriceSourceCandidates({ ...position, displayName: "Another fund" }, "wechat")).toEqual([]);
    expect(discoverPriceSourceCandidates({ ...position, instrumentCode: "012414" }, "wechat")).toEqual([]);
    expect(discoverPriceSourceCandidates(position, "alipay")).toEqual([]);
  });

  it("does not reuse a saved binding after the holding identity changes", () => {
    const binding = {
      sourceAccountId: position.sourceAccountId,
      instrumentId: position.instrumentId,
      instrumentName: position.displayName!,
      instrumentCode: "012414",
      currency: "CNY",
      shareClass: "C",
      provider: "eastmoney" as const,
      identityUrl: "https://example.test",
      confirmedAt: "2026-10-03T00:00:00.000Z",
    };
    expect(bindingMatchesPosition(binding, position)).toBe(true);
    expect(bindingMatchesPosition(binding, { ...position, displayName: "Other fund" })).toBe(false);
    expect(bindingMatchesPosition(binding, { ...position, instrumentCode: "123456" })).toBe(false);
    const state = { positions: [position], cashBalances: [], appliedEventIds: [] };
    expect(applyConfirmedPriceSources(state, [binding]).positions[0]?.instrumentCode).toBe("012414");
    expect(state.positions[0]?.instrumentCode).toBe("unmatched-code");
  });
});
