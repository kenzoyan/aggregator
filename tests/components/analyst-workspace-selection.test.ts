import { describe, expect, it } from "vitest";
import type { PortfolioAnalystReport } from "@/application/portfolio-analyst-provider";
import type { AnalystEvidenceFact } from "@/application/portfolio-analyst-contract";
import { analystContributionPeriod, analystWorkspaceActions, analystWorkspaceFacts } from "@/components/analyst-workspace-selection";

const period: AnalystEvidenceFact = {
  key: "period", kind: "period-performance", label: "Period performance", period: "week",
  coverage: "full", changeEur: 12, percent: 1, priceEffectEur: 10, fxEffectEur: 2,
  provenance: "portfolio-performance",
};
const driver: AnalystEvidenceFact = {
  key: "driver", kind: "holding-driver", label: "Holding contribution", name: "Synthetic fund",
  currentValueEur: 100, portfolioSharePercent: 10, contributionEur: 12, percent: 1,
  freshness: "manual", provenance: "holding-performance",
};
function report(keys: string[], evidence: AnalystEvidenceFact[], claimKeys: string[] = []): PortfolioAnalystReport {
  return {
    provider: "openai", model: "synthetic", generatedAt: "2026-10-11T10:00:00Z",
    contextVersion: "portfolio-analyst-context.v1", job: "explain-period-drivers", language: "en",
    scope: { period: "week" }, factsAsOf: "2026-10-10T10:00:00Z", disclaimer: "Synthetic",
    answer: { factsAsOf: "2026-10-10T10:00:00Z", answer: { text: "Synthetic", classification: "fact", evidence: keys },
      claims: claimKeys.length ? [{ text: "Claim", classification: "fact", evidence: claimKeys }] : [], limitations: [], proposedUpdate: null },
    evidence,
  };
}
describe("answer-driven workspace selection", () => {
  it("does not offer actions for unused evidence or unknown citations", () => {
    expect(analystWorkspaceActions(report(["missing"], [period, driver]))).toEqual([]);
  });
  it("offers only contribution for an aggregate period answer", () => {
    expect(analystWorkspaceActions(report(["period"], [period, driver]))).toEqual(["contribution"]);
  });
  it("includes cited claims and keeps at most two actions", () => {
    const answer = report(["period"], [period, driver], ["driver"]);
    expect(analystWorkspaceActions(answer)).toEqual(["contribution", "holdings"]);
    expect(analystWorkspaceFacts(answer, "holdings")).toEqual([driver]);
  });
  it("preserves historical snapshots and different period facts without rewriting them", () => {
    const monthly = { ...period, key: "month", period: "month" as const, changeEur: -30 };
    const answer = report(["month"], [period, monthly]);
    expect(analystWorkspaceFacts(answer, "contribution")).toEqual([monthly]);
    expect(answer.scope.period).toBe("week");
    expect(answer.factsAsOf).toBe("2026-10-10T10:00:00Z");
    expect(analystContributionPeriod(answer)).toBe("month");
  });
});
