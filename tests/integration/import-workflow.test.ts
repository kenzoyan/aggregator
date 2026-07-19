import { describe, expect, it } from "vitest";

import { createPortfolioRepository } from "@/infrastructure/sqlite/portfolio-repository";

describe("screenshot import confirmation workflow", () => {
  it("allows the demo review flow without adding synthetic holdings to the portfolio", () => {
    const repository = createPortfolioRepository(":memory:");
    repository.createImportDraft({
      id: "draft-demo",
      sourceAccountId: "alipay-main",
      sourceKind: "demo",
      createdAt: "2026-07-19T10:00:00.000Z",
      confidence: "high",
      warnings: [],
      proposedOpeningSnapshot: {
        id: "snapshot-demo",
        sourceAccountId: "alipay-main",
        asOf: "2026-07-19T10:00:00.000Z",
        positions: [{
          instrumentId: "Synthetic Example Fund",
          quantity: "1",
          currency: "CNY",
          costBasis: "100",
        }],
      },
    });

    repository.confirmImportDraft("draft-demo", "2026-07-19T10:01:00.000Z");

    expect(repository.getImportDraft("draft-demo")?.status).toBe("confirmed");
    expect(repository.getOpeningSnapshots()).toEqual([]);
    expect(repository.getPortfolioState().positions).toEqual([]);
    repository.close();
  });

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

  it("uses the later confirmation when source timestamps are equal", () => {
    const repository = createPortfolioRepository(":memory:");
    repository.createImportDraft({
      id: "z-first-draft",
      sourceAccountId: "danske-main",
      sourceKind: "manual",
      createdAt: "2026-07-19T10:00:00.000Z",
      confidence: "manual",
      warnings: [],
      proposedOpeningSnapshot: {
        id: "z-first-snapshot",
        sourceAccountId: "danske-main",
        asOf: "2026-07-18T10:00:00.000Z",
        positions: [],
      },
    });
    repository.createImportDraft({
      id: "a-second-draft",
      sourceAccountId: "danske-main",
      sourceKind: "manual",
      createdAt: "2026-07-19T10:01:00.000Z",
      confidence: "manual",
      warnings: [],
      proposedOpeningSnapshot: {
        id: "a-second-snapshot",
        sourceAccountId: "danske-main",
        asOf: "2026-07-18T10:00:00.000Z",
        positions: [
          { instrumentId: "bond-a", quantity: "1", currency: "EUR", costBasis: "100" },
          { instrumentId: "bond-b", quantity: "1", currency: "EUR", costBasis: "100" },
        ],
      },
    });

    repository.confirmImportDraft("z-first-draft", "2026-07-19T10:02:00.000Z");
    repository.confirmImportDraft("a-second-draft", "2026-07-19T10:03:00.000Z");

    expect(repository.getPortfolioState().positions).toHaveLength(2);
    expect(repository.getConfirmedSnapshots().at(-1)?.snapshot.id).toBe("a-second-snapshot");
    repository.close();
  });
});
