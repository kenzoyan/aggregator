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

const accountPortfolio = {
  ...portfolio,
  holdings: [{
    id: "synthetic-holding",
    sourceAccountId: "trading212-main",
    name: "Synthetic Fund",
    analystDisplayName: "Synthetic Fund",
    symbol: "SYNTH-1",
    category: "Fund",
    currency: "EUR",
    originalValue: "EUR 120",
    eurValue: 120,
    freshness: "fresh",
    asOf: "2026-09-16",
    detail: {
      quantity: "2", currentPrice: "60", currentPriceAsOf: "2026-09-15",
      currentPriceSource: "synthetic-market-feed",
    },
  }, {
    id: "other-holding",
    sourceAccountId: "other-account",
    name: "Other Fund",
    symbol: "OTHER",
    category: "Fund",
    currency: "EUR",
    originalValue: "EUR 99",
    eurValue: 99,
    freshness: "fresh",
    asOf: "2026-09-16",
  }],
} as AnalystPortfolioReadModel;

describe("portfolio analyst account tools", () => {
  it("reads only one account's confirmed holdings as bounded current evidence", () => {
    const context = createPortfolioAnalystTools(accountPortfolio, accounts)
      .readAccountHoldings({ accountType: "Trading 212", language: "en", includeHoldingNames: true });

    expect(context.facts).toEqual([
      expect.objectContaining({ kind: "account-holdings-summary", found: true, holdingCount: 1, totalValueEur: 120 }),
      expect.objectContaining({
        kind: "account-holding", name: "Synthetic Fund", quantity: "2", valueEur: 120,
        unitPrice: "60", priceAsOf: "2026-09-15", priceSource: "synthetic-market-feed",
      }),
    ]);
    expect(context.allowedActions).toEqual([]);
  });

  it("resolves account labels but withholds holding names when sharing is disabled", () => {
    const labeledAccounts = [{ ...accounts[0]!, label: "Primary Brokerage" }];
    const context = createPortfolioAnalystTools(accountPortfolio, labeledAccounts)
      .readAccountHoldings({ accountType: "Primary Brokerage", language: "en", includeHoldingNames: false });
    expect(context.facts[0]).toMatchObject({ found: true, holdingCount: 1 });
    expect(context.facts[1]).not.toHaveProperty("name");
    expect(context.facts[1]).not.toHaveProperty("symbol");
    expect(context.facts[0]).not.toHaveProperty("displayName");
  });

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
