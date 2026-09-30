import { describe, expect, it } from "vitest";

import type { AnalystPortfolioReadModel } from "@/application/portfolio-analyst-contract";
import { createPortfolioAnalystTools } from "@/application/portfolio-analyst-tools";
import { createSourceAccountDefinition } from "@/domain/source-accounts";

const portfolio = {
  insights: { asOf: "2026-09-16T12:00:00.000Z" },
} as AnalystPortfolioReadModel;

const accounts = [createSourceAccountDefinition({
  id: "trading212-main",
  accountType: "Trading 212",
})];

describe("portfolio analyst account tools", () => {
  it("reads the current account registry as bounded evidence", () => {
    const context = createPortfolioAnalystTools(portfolio, accounts)
      .readAccounts({ language: "en", includeAccountNames: true });

    expect(context.job).toBe("manage-accounts");
    expect(context.facts).toEqual([expect.objectContaining({
      kind: "source-account",
      accountType: "Trading 212",
    })]);
    expect(context.allowedActions).toEqual([{
      kind: "start-account-import",
      accountType: "Trading 212",
      label: "Trading 212",
      reasonEvidenceKey: "account.1",
    }]);
  });

  it("withholds custom account names when name sharing is disabled", () => {
    const context = createPortfolioAnalystTools(portfolio, accounts)
      .readAccounts({ language: "en", includeAccountNames: false });

    expect(context.facts[0]).not.toHaveProperty("displayName");
    expect(context.facts[0]).toMatchObject({ accountType: "Trading 212" });
    expect(context.allowedActions[0]).toMatchObject({ label: "Trading 212" });
  });

  it("offers one exact create action for a missing normalized account type", () => {
    const context = createPortfolioAnalystTools(portfolio, accounts)
      .proposeCreateAccount({
        accountType: " Nordea ",
        label: "Brokerage",
        language: "en",
      });

    expect(context.facts).toEqual([expect.objectContaining({
      kind: "source-account-proposal",
      accountType: "Nordea",
      displayName: "Brokerage",
      alreadyExists: false,
    })]);
    expect(context.allowedActions).toEqual([{
      kind: "create-account",
      accountType: "Nordea",
      label: "Brokerage",
      reasonEvidenceKey: "account.proposal",
    }]);
  });

  it("does not offer a create action for an existing normalized type", () => {
    const context = createPortfolioAnalystTools(portfolio, accounts)
      .proposeCreateAccount({
        accountType: " trading-212 ",
        language: "en",
      });

    expect(context.facts).toEqual([expect.objectContaining({ alreadyExists: true })]);
    expect(context.allowedActions).toEqual([]);
  });

  it("offers an import handoff only for an existing normalized account type", () => {
    const context = createPortfolioAnalystTools(portfolio, accounts)
      .prepareAccountImport({
        accountType: " trading-212 ",
        language: "en",
      });

    expect(context.facts).toEqual([expect.objectContaining({
      kind: "source-account-import-target",
      requestedAccountType: "trading-212",
      accountType: "Trading 212",
      displayName: "Trading 212",
      found: true,
    })]);
    expect(context.allowedActions).toEqual([{
      kind: "start-account-import",
      accountType: "Trading 212",
      label: "Trading 212",
      reasonEvidenceKey: "account.import-target",
    }]);
  });

  it("does not offer an import handoff for an unknown account type", () => {
    const context = createPortfolioAnalystTools(portfolio, accounts)
      .prepareAccountImport({ accountType: "Nordea", language: "en" });

    expect(context.facts).toEqual([expect.objectContaining({
      kind: "source-account-import-target",
      requestedAccountType: "Nordea",
      found: false,
    })]);
    expect(context.allowedActions).toEqual([]);
  });
});
