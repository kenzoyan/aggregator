import { describe, expect, it } from "vitest";

import { createPortfolioRepository } from "@/infrastructure/sqlite/portfolio-repository";

describe("source account labels", () => {
  it("persists a private custom label without changing the stable account id", () => {
    const repository = createPortfolioRepository(":memory:");

    expect(repository.getSourceAccountLabels()).toEqual({});
    repository.renameSourceAccount("danske-main", "Retirement bonds");

    expect(repository.getSourceAccountLabels()).toEqual({
      "danske-main": "Retirement bonds",
    });
    expect(() => repository.renameSourceAccount("missing", "Nope")).toThrow(
      "Unknown Source Account",
    );
    repository.close();
  });
});
