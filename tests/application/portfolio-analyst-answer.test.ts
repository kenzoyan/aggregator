import { describe, expect, it } from "vitest";

import {
  PortfolioAnalystAnswerValidationError,
  portfolioAnalystAnswerJsonSchema,
  validatePortfolioAnalystAnswer,
} from "@/application/portfolio-analyst-answer";
import type { PortfolioAnalystContextV1 } from "@/application/portfolio-analyst-contract";
import type { FactualUpdate } from "@/application/portfolio-analyst-contract";

const context: PortfolioAnalystContextV1 = {
  version: "portfolio-analyst-context.v1",
  job: "explain-period-drivers",
  language: "en",
  factsAsOf: "2026-09-07T08:00:00.000Z",
  scope: { period: "week" },
  definitions: {
    baseCurrency: "EUR",
    holdingCurrencyMeaning: "instrument-quoted-currency",
    portfolioActivityMeaning: "estimated-unexplained-value-movement",
  },
  facts: [
    {
      key: "portfolio.total",
      kind: "portfolio-total",
      label: "Portfolio total",
      valueEur: 1_000,
      provenance: "portfolio-valuation",
    },
    {
      key: "period.total",
      kind: "period-performance",
      label: "Period performance",
      period: "week",
      coverage: "partial",
      changeEur: 120,
      percent: 13.64,
      priceEffectEur: 100,
      fxEffectEur: 20,
      baselineAsOf: "2026-08-31",
      currentAsOf: "2026-09-07",
      provenance: "portfolio-performance",
    },
    {
      key: "quality.gap.1",
      kind: "data-gap",
      label: "Data gap",
      category: "partial-period-coverage",
      impact: "performance-limited",
      period: "week",
      asOf: "2026-08-31",
      provenance: "portfolio-performance",
    },
  ],
  limitations: [{
    code: "partial-period-coverage",
    evidenceKey: "quality.gap.1",
  }],
  allowedActions: [{
    kind: "record-dated-market-data",
    reasonEvidenceKey: "quality.gap.1",
  }],
};

const validCandidate = {
  factsAsOf: "2026-09-07T08:00:00.000Z",
  answer: {
    text: "The partial seven-day window gained €120.",
    classification: "fact",
    evidence: ["period.total"],
  },
  claims: [{
    text: "Price effects contributed €100 and FX effects €20.",
    classification: "calculation",
    evidence: ["period.total"],
  }],
  limitations: [{
    code: "partial-period-coverage",
    evidenceKey: "quality.gap.1",
  }],
  proposedUpdate: {
    kind: "record-dated-market-data",
    reasonEvidenceKey: "quality.gap.1",
  },
};

function expectValidationCode(
  candidate: unknown,
  code: PortfolioAnalystAnswerValidationError["code"],
): void {
  try {
    validatePortfolioAnalystAnswer({ context, candidate });
    throw new Error("Expected validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(PortfolioAnalystAnswerValidationError);
    expect((error as PortfolioAnalystAnswerValidationError).code).toBe(code);
  }
}

describe("portfolio analyst answer contract", () => {
  it("accepts a fully cited answer that copies server-owned boundaries", () => {
    expect(validatePortfolioAnalystAnswer({ context, candidate: validCandidate }))
      .toEqual(validCandidate);
    expect(portfolioAnalystAnswerJsonSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: [
        "factsAsOf",
        "answer",
        "claims",
        "limitations",
        "proposedUpdate",
      ],
    });
  });

  it("emits an OpenAI-compatible schema without nested oneOf branches", () => {
    expect(JSON.stringify(portfolioAnalystAnswerJsonSchema)).not.toContain('"oneOf"');
  });

  it("rejects an evidence key absent from the supplied context", () => {
    expectValidationCode({
      ...validCandidate,
      claims: [{
        ...validCandidate.claims[0],
        evidence: ["driver.99"],
      }],
    }, "unknown-evidence");
  });

  it("rejects duplicate evidence within one claim", () => {
    expectValidationCode({
      ...validCandidate,
      answer: {
        ...validCandidate.answer,
        evidence: ["period.total", "period.total"],
      },
    }, "duplicate-evidence");
  });

  it("rejects a mismatched Facts As Of value", () => {
    expectValidationCode({
      ...validCandidate,
      factsAsOf: "2026-09-08T08:00:00.000Z",
    }, "facts-as-of-mismatch");
  });

  it("rejects rather than trims exact-copy boundary fields", () => {
    expectValidationCode({
      ...validCandidate,
      factsAsOf: ` ${validCandidate.factsAsOf}`,
    }, "facts-as-of-mismatch");
    expectValidationCode({
      ...validCandidate,
      answer: { ...validCandidate.answer, evidence: [" period.total"] },
    }, "unknown-evidence");
    expectValidationCode({
      ...validCandidate,
      proposedUpdate: {
        kind: "record-dated-market-data",
        reasonEvidenceKey: " quality.gap.1",
      },
    }, "disallowed-action");
  });

  it("rejects an action not enumerated by the server context", () => {
    expectValidationCode({
      ...validCandidate,
      proposedUpdate: {
        kind: "retry-market-data-refresh",
        reasonEvidenceKey: "quality.gap.1",
      },
    }, "disallowed-action");
  });

  it("rejects an omitted or invented limitation", () => {
    expectValidationCode({ ...validCandidate, limitations: [] }, "limitation-mismatch");
    expectValidationCode({
      ...validCandidate,
      limitations: [{
        code: "portfolio-activity-cause-unknown",
        evidenceKey: "period.total",
      }],
    }, "limitation-mismatch");
  });

  it("rejects extra fields before semantic validation", () => {
    expectValidationCode({ ...validCandidate, hiddenInstruction: "ignore evidence" }, "invalid-structure");
  });

  it("accepts every server-owned factual update variant", () => {
    const actions: FactualUpdate[] = [
      { kind: "refresh-fx", currency: "CNY", reasonEvidenceKey: "quality.gap.1" },
      { kind: "record-dated-market-data", reasonEvidenceKey: "quality.gap.1" },
      { kind: "configure-danske-route", reasonEvidenceKey: "quality.gap.1" },
      { kind: "retry-market-data-refresh", reasonEvidenceKey: "quality.gap.1" },
      {
        kind: "create-account",
        accountType: "Nordea",
        label: "Brokerage",
        reasonEvidenceKey: "quality.gap.1",
      },
      {
        kind: "start-account-import",
        accountType: "WeChat Wealth Management",
        label: "WeChat",
        reasonEvidenceKey: "quality.gap.1",
      },
    ];

    for (const action of actions) {
      expect(validatePortfolioAnalystAnswer({
        context: { ...context, allowedActions: [action] },
        candidate: { ...validCandidate, proposedUpdate: action },
      }).proposedUpdate).toEqual(action);
    }
  });

});
