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
  };
}
