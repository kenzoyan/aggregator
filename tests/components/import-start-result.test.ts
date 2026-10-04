import { describe, expect, it } from "vitest";

import { parseImportStartResult } from "@/components/import-start-result";

describe("import start result", () => {
  it("distinguishes a review draft from a price-only refresh", () => {
    const draft = {
      id: "synthetic-draft", sourceAccountId: "synthetic-account",
      sourceKind: "csv", status: "draft", portfolio: { holdings: [] },
    };
    expect(parseImportStartResult({ outcome: "review-required", draft }, true, "Import failed."))
      .toMatchObject({ outcome: "review-required", draft });
    expect(parseImportStartResult({
      outcome: "market-data-only", message: "Prices updated. No holding changes need review.",
    }, true, "Import failed.")).toEqual({
      outcome: "market-data-only", message: "Prices updated. No holding changes need review.",
    });
  });

  it("preserves a useful server error and rejects malformed success responses", () => {
    expect(() => parseImportStartResult({ error: "Read-only key is unavailable." }, false, "Sync failed."))
      .toThrow("Read-only key is unavailable.");
    expect(() => parseImportStartResult({ outcome: "review-required" }, true, "Sync failed."))
      .toThrow("Sync failed.");
    expect(() => parseImportStartResult({
      outcome: "review-required", draft: { id: "draft", status: "draft", portfolio: {} },
    }, true, "Sync failed.")).toThrow("Sync failed.");
  });
});
