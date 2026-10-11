import { describe, expect, it } from "vitest";
import { createContributionResearchQuestion } from "@/application/portfolio-contribution-research";
import type { PortfolioPeriodAnalysis } from "@/application/portfolio-period-analysis";

function analysis(): PortfolioPeriodAnalysis {
  return { period: "month", factsAsOf: "2026-10-11", method: "current-quantity", available: true, coverage: "partial",
    baselineAsOf: "2026-09-12T12:00:00Z", currentAsOf: "2026-10-10T12:00:00Z", contributionSumEur: 0, activityCoverage: "unavailable", events: [],
    holdings: Array.from({ length: 7 }, (_, index) => ({ id: String(index), sourceAccountId: "demo", account: "Demo", name: `Synthetic ${index}`, currency: "EUR", status: "included",
      contribution: { holdingId: String(index), change: index - 3, baselineValueEur: 100, currentValueEur: 100 + index - 3,
        baselineAsOf: "2026-09-15", currentAsOf: "2026-10-10" } })) };
}
describe("date-bound research questions", () => {
  it("uses actual valuation dates and the period rather than retrieval date", () => {
    const question = createContributionResearchQuestion(analysis(), "en");
    expect(question).toContain("2026-09-12 → 2026-10-10");
    expect(question).toContain("30 days");
    expect(question).not.toContain("2026-10-11");
    expect(question).toContain("2026-09-15 → 2026-10-10");
    expect(question.match(/Synthetic/g)).toHaveLength(5);
    expect(question).toContain("with sources");
    expect(question.length).toBeLessThanOrEqual(600);
  });
  it("researches only the selected holding and preserves its dates", () => {
    const data = analysis();
    const question = createContributionResearchQuestion(data, "zh-CN", data.holdings[1]);
    expect(question).toContain("Synthetic 1");
    expect(question).not.toContain("Synthetic 0");
    expect(question).toContain("并附上来源");
    expect(question).toContain("2026-09-15 → 2026-10-10");
  });
  it("keeps long holding lists and unusually long selected names within the API limit", () => {
    const data = analysis();
    data.holdings.forEach((holding, index) => { holding.name = `Synthetic ${index} ${"long fund name ".repeat(70)}`; });
    for (const language of ["en", "zh-CN"] as const) {
      for (const selected of [undefined, data.holdings[0]]) {
        const question = createContributionResearchQuestion(data, language, selected);
        expect(question.length).toBeLessThanOrEqual(600);
        expect(question).toContain("2026-09-12 → 2026-10-10");
        expect(question).toContain("2026-09-15 → 2026-10-10");
        expect(question).toContain("Synthetic");
      }
    }
  });
});
