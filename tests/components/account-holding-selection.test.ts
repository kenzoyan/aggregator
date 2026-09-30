import { describe, expect, it } from "vitest";

import { selectAccountHolding } from "@/components/account-holding-selection";

describe("account holding selection", () => {
  const rows = [
    { id: "a:fund", sourceAccountId: "a" },
    { id: "b:fund", sourceAccountId: "b" },
    { id: "a:cash:EUR", sourceAccountId: "a" },
  ];

  it("selects within the account and defaults to its first holding", () => {
    expect(selectAccountHolding(rows, "a", "a:cash:EUR")).toBe(rows[2]);
    expect(selectAccountHolding(rows, "a")).toBe(rows[0]);
    expect(selectAccountHolding(rows, "a", "b:fund")).toBe(rows[0]);
  });

  it("returns no selection for an empty account", () => {
    expect(selectAccountHolding(rows, "empty")).toBeUndefined();
  });
});
