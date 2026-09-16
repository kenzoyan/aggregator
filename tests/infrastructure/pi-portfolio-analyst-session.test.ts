import { describe, expect, it } from "vitest";

import type { PortfolioAnalystContextV1 } from "@/application/portfolio-analyst-contract";
import type { PortfolioAnalystProvider } from "@/application/portfolio-analyst-provider";
import { piPortfolioAnalystSessionFactory } from "@/infrastructure/pi/pi-portfolio-analyst-session";

const context: PortfolioAnalystContextV1 = {
  version: "portfolio-analyst-context.v1",
  job: "explain-period-drivers",
  language: "zh-CN",
  factsAsOf: "2026-09-09T10:00:00.000Z",
  scope: { period: "week" },
  definitions: {
    baseCurrency: "EUR",
    holdingCurrencyMeaning: "instrument-quoted-currency",
    portfolioActivityMeaning: "estimated-unexplained-value-movement",
  },
  facts: [{
    key: "period.total",
    kind: "period-performance",
    label: "Period performance",
    period: "week",
    coverage: "full",
    changeEur: 10,
    percent: 1,
    priceEffectEur: 8,
    fxEffectEur: 2,
    provenance: "portfolio-performance",
  }],
  limitations: [],
  allowedActions: [],
};

describe("Pi portfolio analyst session adapter", () => {
  it("passes bounded history and the current question to the existing provider", async () => {
    let received: Parameters<PortfolioAnalystProvider["generate"]>[1];
    const provider: PortfolioAnalystProvider = {
      id: "openai",
      model: "synthetic",
      async generate(_context, turn) {
        received = turn;
        return {
          factsAsOf: context.factsAsOf,
          answer: { text: "Current answer", classification: "fact", evidence: ["period.total"] },
          claims: [],
          limitations: [],
          proposedUpdate: null,
        };
      },
    };

    const answer = await piPortfolioAnalystSessionFactory.create(provider).runTurn({
      context,
      question: "为什么 FX 是正的？",
      history: [
        { role: "user", text: "本周怎么样？" },
        { role: "assistant", text: "Earlier answer", factsAsOf: "2026-09-08T10:00:00.000Z" },
      ],
    });

    expect(received).toMatchObject({
      question: "为什么 FX 是正的？",
      history: [
        { role: "user", text: "本周怎么样？" },
        { role: "assistant", text: "Earlier answer", factsAsOf: "2026-09-08T10:00:00.000Z" },
      ],
    });
    expect(answer.answer.text).toBe("Current answer");
  });

  it("propagates provider failures without persisting an invented answer", async () => {
    const expected = new Error("provider failed");
    const provider: PortfolioAnalystProvider = {
      id: "openai",
      model: "synthetic",
      generate: async () => { throw expected; },
    };

    await expect(piPortfolioAnalystSessionFactory.create(provider).runTurn({
      context,
      question: "本周怎么样？",
      history: [],
    })).rejects.toBe(expected);
  });
});
