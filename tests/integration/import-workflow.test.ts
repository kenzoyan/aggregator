import { describe, expect, it } from "vitest";

import { createPortfolioRepository } from "@/infrastructure/sqlite/portfolio-repository";

describe("screenshot import confirmation workflow", () => {
  it("keeps an Import Draft out of the Tracked Portfolio until confirmation", () => {
    const repository = createPortfolioRepository(":memory:");

    repository.createImportDraft({
      id: "draft-alipay-001",
      sourceAccountId: "alipay",
      sourceKind: "screenshot",
      createdAt: "2026-07-19T10:00:00.000Z",
      confidence: "0.96",
      warnings: [],
      proposedOpeningSnapshot: {
        id: "opening-alipay-001",
        sourceAccountId: "alipay",
        asOf: "2026-07-19T09:00:00.000Z",
        positions: [
          {
            instrumentId: "fund-001",
            quantity: "10",
            currency: "CNY",
            costBasis: "800",
            reportedPriorReturn: "200",
          },
        ],
      },
    });

    expect(repository.getPortfolioState().positions).toEqual([]);

    repository.confirmImportDraft(
      "draft-alipay-001",
      "2026-07-19T10:05:00.000Z",
    );
    repository.confirmImportDraft(
      "draft-alipay-001",
      "2026-07-19T10:06:00.000Z",
    );

    expect(repository.getPortfolioState().positions).toEqual([
      {
        sourceAccountId: "alipay",
        instrumentId: "fund-001",
        quantity: "10",
        currency: "CNY",
        costBasis: "800",
        reportedPriorReturn: "200",
      },
    ]);
    expect(repository.getImportDraft("draft-alipay-001")?.status).toBe(
      "confirmed",
    );

    repository.close();
  });

  it("uses the reviewed Import Draft values when confirming", () => {
    const repository = createPortfolioRepository(":memory:");
    repository.createImportDraft({
      id: "draft-reviewed-001",
      sourceAccountId: "wechat",
      sourceKind: "screenshot",
      createdAt: "2026-07-19T10:00:00.000Z",
      confidence: "0.72",
      warnings: ["Cost Basis needs review"],
      proposedOpeningSnapshot: {
        id: "opening-wechat-001",
        sourceAccountId: "wechat",
        asOf: "2026-07-19T09:00:00.000Z",
        positions: [
          {
            instrumentId: "fund-002",
            quantity: "10",
            currency: "CNY",
            costBasis: "800",
          },
        ],
      },
    });

    repository.updateImportDraft("draft-reviewed-001", {
      confidence: "1",
      warnings: [],
      proposedOpeningSnapshot: {
        id: "opening-wechat-001",
        sourceAccountId: "wechat",
        asOf: "2026-07-19T09:00:00.000Z",
        positions: [
          {
            instrumentId: "fund-002",
            quantity: "10",
            currency: "CNY",
            costBasis: "750",
          },
        ],
      },
    });
    repository.confirmImportDraft(
      "draft-reviewed-001",
      "2026-07-19T10:05:00.000Z",
    );

    expect(repository.getPortfolioState().positions[0]?.costBasis).toBe("750");
    repository.close();
  });
});
