import { describe, expect, it } from "vitest";

import {
  createSourceAccountDefinition,
  effectiveSourceAccountLabels,
  normalizeSourceAccountType,
  sourceAccountIdForType,
} from "@/domain/source-accounts";

describe("source accounts", () => {
  it("normalizes equivalent account type names to one stable key", () => {
    expect(normalizeSourceAccountType(" Trading 212 ")).toBe("trading212");
    expect(normalizeSourceAccountType("TRADING-212")).toBe("trading212");
    expect(normalizeSourceAccountType("Danske Bank")).toBe("danskebank");
  });

  it("gives an arbitrary account type generic import capabilities", () => {
    expect(createSourceAccountDefinition({
      id: "account-nordnet",
      accountType: "Nordnet",
    })).toEqual({
      id: "account-nordnet",
      accountType: "Nordnet",
      normalizedAccountType: "nordnet",
      provider: "generic",
      label: "Nordnet",
      dashboardLabel: "Nordnet",
      updateMethod: "screenshot",
    });
  });

  it("recognizes the built-in Trading 212 connector from the account type", () => {
    expect(createSourceAccountDefinition({
      id: "account-trading212",
      accountType: "Trading 212",
      label: "Broker",
    })).toMatchObject({
      normalizedAccountType: "trading212",
      provider: "trading212",
      label: "Broker",
      updateMethod: "trading-212",
    });
  });

  it("recognizes WeChat Wealth as a WeChat account", () => {
    expect(createSourceAccountDefinition({
      id: "account-wechat-wealth",
      accountType: "WeChat Wealth",
    }).provider).toBe("wechat");
  });

  it("restores stable ids for known account types", () => {
    expect(sourceAccountIdForType("WeChat Wealth Management", "account-random"))
      .toBe("wechat-main");
    expect(sourceAccountIdForType("Trading-212", "account-random"))
      .toBe("trading212-main");
    expect(sourceAccountIdForType("Nordnet", "account-random"))
      .toBe("account-random");
  });

  it("keeps dynamic account labels available to portfolio read models", () => {
    const account = createSourceAccountDefinition({
      id: "account-nordnet",
      accountType: "Nordnet",
      label: "Long-term broker",
    });

    expect(effectiveSourceAccountLabels([account])).toEqual({
      "account-nordnet": "Long-term broker",
    });
    expect(effectiveSourceAccountLabels([account], {
      "account-nordnet": "Retirement",
    })).toEqual({
      "account-nordnet": "Retirement",
    });
  });
});
