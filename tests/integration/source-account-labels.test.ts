import { describe, expect, it } from "vitest";

import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

describe("source account labels", () => {
  it("persists a private custom label without changing the stable account id", () => {
    const database = createPortfolioDatabase(":memory:");

    expect(database.readSourceAccountLabels()).toEqual({});
    database.renameSourceAccount("danske-main", "Retirement bonds");

    expect(database.readSourceAccountLabels()).toEqual({
      "danske-main": "Retirement bonds",
    });
    expect(() => database.renameSourceAccount("missing", "Nope")).toThrow(
      "Unknown Source Account",
    );
    database.close();
  });
});
