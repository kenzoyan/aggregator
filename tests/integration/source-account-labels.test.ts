import { describe, expect, it } from "vitest";

import { createManualImportDraft } from "@/application/imports/manual-import";
import { draftPortfolioFromOpeningSnapshot } from "@/domain/imports";
import { createPortfolioDatabase } from "@/infrastructure/sqlite/portfolio-repository";

describe("source account labels", () => {
  it("seeds the existing accounts and creates one arbitrary account per normalized type", () => {
    const database = createPortfolioDatabase(":memory:");

    expect(database.readSourceAccounts().map((account) => account.id)).toEqual([
      "alipay-main",
      "danske-main",
      "trading212-main",
      "wechat-main",
    ]);

    const nordnet = database.createSourceAccount({
      id: "account-nordnet",
      accountType: "Nordnet",
    });
    expect(nordnet).toMatchObject({
      id: "account-nordnet",
      accountType: "Nordnet",
      normalizedAccountType: "nordnet",
      provider: "generic",
      updateMethod: "screenshot",
    });
    expect(() => database.createSourceAccount({
      id: "account-nordnet-duplicate",
      accountType: " nord-net ",
    })).toThrow("Source Account type already exists");
    expect(() => database.createSourceAccount({
      id: "wechat-main",
      accountType: "WeChat",
    })).toThrow("Source Account type already exists");
    database.close();
  });

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

  it("renames a dynamically created account", () => {
    const database = createPortfolioDatabase(":memory:");
    database.createSourceAccount({
      id: "account-nordnet",
      accountType: "Nordnet",
    });

    database.renameSourceAccount("account-nordnet", "Long-term broker");

    expect(database.readSourceAccounts().find((account) =>
      account.id === "account-nordnet"
    )?.label).toBe("Long-term broker");
    database.close();
  });

  it("deletes an empty custom account without affecting built-in accounts", () => {
    const database = createPortfolioDatabase(":memory:");
    database.createSourceAccount({
      id: "account-nordnet",
      accountType: "Nordnet",
    });
    database.saveImportDraft(createManualImportDraft({
      draftId: "draft-unconfirmed",
      snapshotId: "snapshot-unconfirmed",
      sourceAccountId: "account-nordnet",
      createdAt: "2026-09-16T12:00:00.000Z",
    }));

    database.deleteSourceAccount("account-nordnet");

    expect(database.readSourceAccounts().some((account) =>
      account.id === "account-nordnet"
    )).toBe(false);
    expect(database.getImportDraft("draft-unconfirmed")).toBeUndefined();
    expect(database.readSourceAccounts()).toHaveLength(4);
    database.close();
  });

  it("deletes an empty seeded account but protects accounts with confirmed data", () => {
    const database = createPortfolioDatabase(":memory:");
    database.createSourceAccount({
      id: "account-nordnet",
      accountType: "Nordnet",
    });
    const draft = {
      id: "draft-nordnet",
      sourceAccountId: "account-nordnet",
      sourceKind: "manual",
      createdAt: "2026-09-16T12:00:00.000Z",
      confidence: "high",
      warnings: [],
      portfolio: draftPortfolioFromOpeningSnapshot({
        id: "snapshot-nordnet",
        sourceAccountId: "account-nordnet",
        asOf: "2026-09-16T12:00:00.000Z",
        positions: [],
      }, "manual"),
    } as const;
    database.saveImportDraft(draft);
    database.confirmImport({
      draftId: "draft-nordnet",
      confirmedImportId: "confirmed-nordnet",
      confirmedAt: "2026-09-16T12:01:00.000Z",
      review: {
        confidence: draft.confidence,
        warnings: draft.warnings,
        portfolio: draft.portfolio,
      },
    });

    database.deleteSourceAccount("wechat-main");
    expect(database.readSourceAccounts().some((account) =>
      account.id === "wechat-main"
    )).toBe(false);
    expect(() => database.deleteSourceAccount("account-nordnet"))
      .toThrow("Source Account has portfolio data");
    expect(database.readSourceAccounts().some((account) =>
      account.id === "account-nordnet"
    )).toBe(true);
    database.close();
  });
});
