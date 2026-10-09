import { describe, expect, it } from "vitest";
import { createAccountHoldingsFallback } from "@/application/portfolio-analyst-account-fallback";
import { validatePortfolioAnalystAnswer } from "@/application/portfolio-analyst-answer";
import type { PortfolioAnalystContextV1 } from "@/application/portfolio-analyst-contract";

function fixture(): PortfolioAnalystContextV1 {
  const context: PortfolioAnalystContextV1 = {
    version: "portfolio-analyst-context.v1", job: "summarize-portfolio", language: "en", factsAsOf: "2026-10-09T12:00:00Z",
    scope: {}, definitions: { baseCurrency: "EUR", holdingCurrencyMeaning: "instrument-quoted-currency", portfolioActivityMeaning: "estimated-unexplained-value-movement" },
    facts: [], limitations: [], allowedActions: [],
  };
  let index = 0;
  for (const [account, count] of [2, 3, 5, 2, 5].entries()) {
    const key = `call1.account${account}.account.holdings.summary`;
    context.facts.push({ key, kind: "account-holdings-summary", label: "Account holdings summary", requestedAccount: `Demo ${account}`,
      accountType: `Demo ${account}`, found: true, holdingCount: count, shownHoldingCount: count, totalValueEur: count * 100, provenance: "portfolio-read-model" });
    for (let i = 0; i < count; i++) {
      index += 1;
      context.facts.push({ key: `call1.account${account}.account.holding.${i}`, accountEvidenceKey: key,
        kind: "account-holding", label: "Account holding", name: `Synthetic investment position ${index}`, category: "Fund",
        currency: "EUR", originalValue: "EUR 100.00", valueEur: 100, freshness: "fresh", asOf: "2026-10-09", provenance: "portfolio-read-model" });
    }
  }
  return context;
}

describe("complete account fallback", () => {
  it("keeps all five accounts and seventeen holdings in a validated reply longer than 800 characters", () => {
    const context = fixture();
    const candidate = createAccountHoldingsFallback(context)!;
    expect(candidate.answer.text.length).toBeGreaterThan(800);
    for (let i = 0; i < 5; i++) expect(candidate.answer.text).toContain(`## Demo ${i}`);
    for (let i = 1; i <= 17; i++) expect(candidate.answer.text).toContain(`Synthetic investment position ${i}:`);
    expect(candidate.answer.evidence).toHaveLength(22);
    expect(validatePortfolioAnalystAnswer({ context, candidate })).toEqual(candidate);
  });
  it("does not silently fall back to one account when complete evidence is missing", () => {
    const context = fixture();
    context.facts.pop();
    expect(createAccountHoldingsFallback(context)).toBeUndefined();
  });
});
