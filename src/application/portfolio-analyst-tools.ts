import { createActivityHistoryContext } from "@/application/portfolio-analyst-activity";
import type { PortfolioFacts } from "@/infrastructure/sqlite/portfolio-repository-contract";
import type { Period } from "@/application/portfolio-read-model";
import type {
  AnalystEvidenceBundleV1,
  AnalystPortfolioReadModel,
  PortfolioAnalystContextV1,
  PortfolioAnalystLanguage,
  PortfolioAnalystTools,
} from "@/application/portfolio-analyst-contract";
import { createPortfolioAnalystContext } from "@/application/portfolio-analyst-context";
import { assertPortfolioAnalystContextSize } from "@/application/portfolio-analyst-context-size";
import {
  normalizeSourceAccountType,
  type SourceAccountDefinition,
} from "@/domain/source-accounts";

const MAX_ACCOUNT_HOLDINGS = 30;

function accountHoldingsContext(input: {
  portfolio: AnalystPortfolioReadModel;
  accounts: readonly SourceAccountDefinition[];
  accountType: string;
  language: PortfolioAnalystLanguage;
  includeHoldingNames: boolean;
  resolvedAccount?: SourceAccountDefinition;
  maxHoldings?: number;
}): PortfolioAnalystContextV1 {
  const requestedAccount = input.accountType.trim();
  const normalized = normalizeSourceAccountType(requestedAccount);
  const account = input.resolvedAccount ?? input.accounts.find((candidate) =>
    candidate.normalizedAccountType === normalized ||
    normalizeSourceAccountType(candidate.label) === normalized
  );
  const holdings = account
    ? input.portfolio.holdings.filter((holding) => holding.sourceAccountId === account.id)
    : [];
  const maxHoldings = input.maxHoldings ?? MAX_ACCOUNT_HOLDINGS;
  return {
    version: "portfolio-analyst-context.v1",
    job: "manage-accounts",
    language: input.language,
    factsAsOf: input.portfolio.insights.asOf,
    scope: {},
    definitions: {
      baseCurrency: "EUR",
      holdingCurrencyMeaning: "instrument-quoted-currency",
      portfolioActivityMeaning: "estimated-unexplained-value-movement",
    },
    facts: [
      {
        key: "account.holdings.summary",
        kind: "account-holdings-summary",
        label: "Account holdings summary",
        requestedAccount,
        found: Boolean(account),
        ...(account ? {
          accountType: account.accountType,
          ...(input.includeHoldingNames ? { displayName: account.label } : {}),
        } : {}),
        holdingCount: holdings.length,
        shownHoldingCount: Math.min(holdings.length, maxHoldings),
        totalValueEur: holdings.reduce((sum, holding) => sum + holding.eurValue, 0),
        provenance: "portfolio-read-model",
      },
      ...holdings.slice(0, maxHoldings).map((holding, index) => ({
        key: `account.holding.${index + 1}`,
        kind: "account-holding" as const,
        label: "Account holding" as const,
        ...(input.includeHoldingNames ? {
          name: holding.analystDisplayName ?? holding.name,
          ...(holding.symbol ? { symbol: holding.symbol } : {}),
        } : {}),
        category: holding.category,
        ...(holding.detail?.quantity ? { quantity: holding.detail.quantity } : {}),
        ...(holding.detail ? {
          unitPrice: holding.detail.currentPrice,
          priceAsOf: holding.detail.currentPriceAsOf,
          priceSource: holding.detail.currentPriceSource,
        } : {}),
        currency: holding.currency,
        originalValue: holding.originalValue,
        valueEur: holding.eurValue,
        freshness: holding.freshness,
        asOf: holding.asOf,
        provenance: "portfolio-read-model" as const,
      })),
    ],
    limitations: [],
    allowedActions: [],
  };
}

function accountContext(input: {
  accounts: readonly SourceAccountDefinition[];
  factsAsOf: string;
  language: PortfolioAnalystLanguage;
  includeAccountNames: boolean;
}): PortfolioAnalystContextV1 {
  return {
    version: "portfolio-analyst-context.v1",
    job: "manage-accounts",
    language: input.language,
    factsAsOf: input.factsAsOf,
    scope: {},
    definitions: {
      baseCurrency: "EUR",
      holdingCurrencyMeaning: "instrument-quoted-currency",
      portfolioActivityMeaning: "estimated-unexplained-value-movement",
    },
    facts: input.accounts.map((account, index) => ({
      key: `account.${index + 1}`,
      kind: "source-account" as const,
      accountId: account.id,
      label: "Source account" as const,
      accountType: account.accountType,
      ...(input.includeAccountNames ? { displayName: account.label } : {}),
      provider: account.provider,
      updateMethod: account.updateMethod,
      provenance: "source-account-registry" as const,
    })),
    limitations: [],
    allowedActions: input.accounts.map((account, index) => ({
      kind: "start-account-import" as const,
      accountType: account.accountType,
      label: input.includeAccountNames ? account.label : account.accountType,
      reasonEvidenceKey: `account.${index + 1}`,
    })),
  };
}

function accountProposalContext(input: {
  accounts: readonly SourceAccountDefinition[];
  accountType: string;
  label?: string;
  factsAsOf: string;
  language: PortfolioAnalystLanguage;
}): PortfolioAnalystContextV1 {
  const accountType = input.accountType.trim().replace(/\s+/g, " ");
  const normalizedAccountType = normalizeSourceAccountType(accountType);
  const displayName = input.label?.trim() || accountType;
  const alreadyExists = input.accounts.some((account) =>
    account.normalizedAccountType === normalizedAccountType
  );
  const reasonEvidenceKey = "account.proposal";
  return {
    ...accountContext({ ...input, includeAccountNames: true }),
    facts: [{
      key: reasonEvidenceKey,
      kind: "source-account-proposal",
      label: "Source account proposal",
      accountType,
      normalizedAccountType,
      displayName,
      alreadyExists,
      provenance: "source-account-registry",
    }],
    allowedActions: alreadyExists || !normalizedAccountType
      ? []
      : [{
          kind: "create-account",
          accountType,
          label: displayName,
          reasonEvidenceKey,
        }],
  };
}

function accountImportContext(input: {
  accounts: readonly SourceAccountDefinition[];
  accountType: string;
  factsAsOf: string;
  language: PortfolioAnalystLanguage;
  includeAccountNames: boolean;
}): PortfolioAnalystContextV1 {
  const requestedAccountType = input.accountType.trim().replace(/\s+/g, " ");
  const normalizedAccountType = normalizeSourceAccountType(requestedAccountType);
  const account = input.accounts.find((candidate) =>
    candidate.normalizedAccountType === normalizedAccountType
  );
  const reasonEvidenceKey = "account.import-target";
  const displayName = account
    ? (input.includeAccountNames ? account.label : account.accountType)
    : undefined;
  return {
    ...accountContext({ ...input, includeAccountNames: input.includeAccountNames }),
    facts: [{
      key: reasonEvidenceKey,
      kind: "source-account-import-target",
      label: "Source account import target",
      requestedAccountType,
      normalizedAccountType,
      found: Boolean(account),
      ...(account ? {
        accountType: account.accountType,
        displayName,
        updateMethod: account.updateMethod,
      } : {}),
      provenance: "source-account-registry",
    }],
    allowedActions: account && displayName
      ? [{
          kind: "start-account-import",
          accountType: account.accountType,
          label: displayName,
          reasonEvidenceKey,
        }]
      : [],
  };
}

function namespaceEvidenceKey(namespace: string, key: string): string {
  return `${namespace}.${key}`;
}

export function namespacePortfolioAnalystContext(
  context: PortfolioAnalystContextV1,
  namespace: string,
): PortfolioAnalystContextV1 {
  const namespaced: PortfolioAnalystContextV1 = {
    ...context,
    facts: context.facts.map((fact) => ({
      ...fact,
      key: namespaceEvidenceKey(namespace, fact.key),
      ...(fact.kind === "account-holding" && fact.accountEvidenceKey
        ? { accountEvidenceKey: namespaceEvidenceKey(namespace, fact.accountEvidenceKey) } : {}),
    })),
    limitations: context.limitations.map((limitation) => ({
      ...limitation,
      evidenceKey: namespaceEvidenceKey(namespace, limitation.evidenceKey),
    })),
    allowedActions: context.allowedActions.map((action) => ({
      ...action,
      reasonEvidenceKey: namespaceEvidenceKey(namespace, action.reasonEvidenceKey),
    })),
  };
  assertPortfolioAnalystContextSize(namespaced);
  return namespaced;
}

export function combinePortfolioAnalystContexts(
  contexts: readonly PortfolioAnalystContextV1[],
): PortfolioAnalystContextV1 {
  const first = contexts[0];
  if (!first || contexts.some((context) =>
    context.factsAsOf !== first.factsAsOf || context.language !== first.language
  )) {
    throw new Error("Portfolio analyst contexts do not share one current snapshot.");
  }
  const combined: PortfolioAnalystContextV1 = {
    ...first,
    facts: contexts.flatMap((context) => context.facts),
    limitations: contexts.flatMap((context) => context.limitations),
    allowedActions: contexts.flatMap((context) => context.allowedActions),
  };
  assertPortfolioAnalystContextSize(combined);
  return combined;
}

export function createPortfolioAnalystTools(
  portfolio: AnalystPortfolioReadModel,
  accounts: readonly SourceAccountDefinition[] = [],
  activityFacts?: PortfolioFacts,
): PortfolioAnalystTools {
  return {
    readAllHoldings(input) {
      const overview = createPortfolioAnalystContext({ portfolio, request: { job: "summarize-portfolio", ...input } });
      const registry = accountContext({ accounts, factsAsOf: portfolio.insights.asOf,
        language: input.language, includeAccountNames: input.includeHoldingNames });
      const contexts = [namespacePortfolioAnalystContext(overview, "overview"), namespacePortfolioAnalystContext(registry, "registry")];
      if (portfolio.holdings.some((holding) => !accounts.some((account) => account.id === holding.sourceAccountId))) {
        throw new Error("Some holdings could not be matched to the account registry; a complete account summary is unavailable.");
      }
      for (const [index, account] of accounts.entries()) {
        const context = accountHoldingsContext({ portfolio, accounts, accountType: account.accountType,
          resolvedAccount: account, maxHoldings: portfolio.holdings.length, ...input });
        context.facts = context.facts.map((fact) => fact.kind === "account-holding"
          ? { ...fact, accountEvidenceKey: "account.holdings.summary" } : fact);
        contexts.push(namespacePortfolioAnalystContext(context, `account${index + 1}`));
      }
      const combined = combinePortfolioAnalystContexts(contexts);
      return { ...combined, allowedActions: [] };
    },
    readHoldingHistory: (request) => createActivityHistoryContext({ request, accounts, facts: activityFacts, factsAsOf: portfolio.insights.asOf }),
    readAccountActivity: (request) => createActivityHistoryContext({ request, accounts, facts: activityFacts, factsAsOf: portfolio.insights.asOf }),
    readPeriodDrivers(input: {
      period: Period;
      language: PortfolioAnalystLanguage;
      includeHoldingNames: boolean;
    }): AnalystEvidenceBundleV1 {
      return createPortfolioAnalystContext({
        portfolio,
        request: { job: "explain-period-drivers", ...input },
      });
    },
    readDataQuality(input: {
      language: PortfolioAnalystLanguage;
      includeHoldingNames: boolean;
    }): AnalystEvidenceBundleV1 {
      return createPortfolioAnalystContext({
        portfolio,
        request: { job: "diagnose-data-quality", ...input },
      });
    },
    readPortfolioOverview(input: {
      language: PortfolioAnalystLanguage;
      includeHoldingNames: boolean;
    }): AnalystEvidenceBundleV1 {
      return createPortfolioAnalystContext({
        portfolio,
        request: { job: "summarize-portfolio", ...input },
      });
    },
    readAccounts(input: {
      language: PortfolioAnalystLanguage;
      includeAccountNames: boolean;
    }): AnalystEvidenceBundleV1 {
      const context = accountContext({
        accounts,
        factsAsOf: portfolio.insights.asOf,
        language: input.language,
        includeAccountNames: input.includeAccountNames,
      });
      assertPortfolioAnalystContextSize(context);
      return context;
    },
    readAccountHoldings(input: {
      accountType: string;
      language: PortfolioAnalystLanguage;
      includeHoldingNames: boolean;
    }): AnalystEvidenceBundleV1 {
      const context = accountHoldingsContext({ portfolio, accounts, ...input });
      assertPortfolioAnalystContextSize(context);
      return context;
    },
    proposeCreateAccount(input: {
      accountType: string;
      label?: string;
      language: PortfolioAnalystLanguage;
    }): AnalystEvidenceBundleV1 {
      const context = accountProposalContext({
        accounts,
        factsAsOf: portfolio.insights.asOf,
        ...input,
      });
      assertPortfolioAnalystContextSize(context);
      return context;
    },
    prepareAccountImport(input: {
      accountType: string;
      language: PortfolioAnalystLanguage;
      includeAccountNames?: boolean;
    }): AnalystEvidenceBundleV1 {
      const context = accountImportContext({
        accounts,
        factsAsOf: portfolio.insights.asOf,
        includeAccountNames: input.includeAccountNames ?? true,
        ...input,
      });
      assertPortfolioAnalystContextSize(context);
      return context;
    },
  };
}
