import { describe, expect, it } from "vitest";

import { resolveRequestedSourceAccountId } from "@/components/source-account-selection";

const accounts = [
  { id: "wechat-main", accountType: "WeChat Wealth Management" },
  { id: "custom-account", accountType: "Nordea Private Banking" },
];

describe("source-account import selection", () => {
  it("resolves a normalized account type to the registered account id", () => {
    expect(resolveRequestedSourceAccountId(accounts, " wechat-wealth management "))
      .toBe("wechat-main");
  });

  it("returns undefined for an unknown account type", () => {
    expect(resolveRequestedSourceAccountId(accounts, "Unknown Bank")).toBeUndefined();
  });
});
