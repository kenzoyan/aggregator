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
      label: "Source account" as const,
      accountType: account.accountType,
      ...(input.includeAccountNames ? { displayName: account.label } : {}),
      provider: account.provider,
      updateMethod: account.updateMethod,
      provenance: "source-account-registry" as const,
    })),
    limitations: [],
    allowedActions: [],
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
): PortfolioAnalystTools {
  return {
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
  };
}
