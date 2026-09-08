import { describe, expect, it } from "vitest";

import type { PortfolioAnalystContextV1 } from "@/application/portfolio-analyst-context";
import { DeepSeekAnalystProvider } from "@/infrastructure/deepseek/deepseek-analyst-provider";
import { OpenAIAnalystProvider } from "@/infrastructure/openai/openai-analyst-provider";

const context: PortfolioAnalystContextV1 = {
  version: "portfolio-analyst-context.v1",
  job: "explain-period-drivers",
  language: "en",
  factsAsOf: "2026-09-08T10:00:00.000Z",
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
    baselineAsOf: "2026-09-01",
    currentAsOf: "2026-09-08",
    provenance: "portfolio-performance",
  }],
  limitations: [],
  allowedActions: [],
};

const answer = {
  factsAsOf: context.factsAsOf,
  answer: {
    text: "The portfolio gained €10.",
    classification: "fact",
    evidence: ["period.total"],
  },
  claims: [],
  limitations: [],
  proposedUpdate: null,
} as const;

function completedResponse(payload: unknown) {
  return Response.json({
    status: "completed",
    output: [{
      type: "message",
      content: [{ type: "output_text", text: JSON.stringify(payload) }],
    }],
  });
}

describe("portfolio analyst providers", () => {
  it("calls OpenAI Responses with strict output, no storage and the bounded context", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new OpenAIAnalystProvider({
      apiKey: "synthetic-openai-key",
      model: "gpt-synthetic",
      fetch: async (input, init) => {
        requests.push({ url: String(input), init });
        return completedResponse(answer);
      },
    });

    await expect(provider.generate(context)).resolves.toEqual(answer);
    const request = requests[0]!;
    expect(request.url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(request.init?.body));
    expect(body).toMatchObject({
      model: "gpt-synthetic",
      store: false,
      reasoning: { effort: "none" },
      text: { format: {
        type: "json_schema",
        name: "portfolio_analyst_answer",
        strict: true,
      } },
    });
    expect(body.instructions).toContain("untrusted data");
    expect(JSON.parse(body.input)).toEqual({ portfolioAnalystContext: context });
  });

  it("uses DeepSeek Responses without sending an unsupported store option", async () => {
    const requests: RequestInit[] = [];
    const provider = new DeepSeekAnalystProvider({
      apiKey: "synthetic-deepseek-key",
      model: "deepseek-synthetic",
      fetch: async (_input, init) => {
        requests.push(init ?? {});
        return completedResponse(answer);
      },
    });

    await expect(provider.generate(context)).resolves.toEqual(answer);
    const body = JSON.parse(String(requests[0]?.body));
    expect(body).not.toHaveProperty("store");
    expect(body.text.format.strict).toBe(true);
  });

  it("rejects structurally valid output that cites evidence outside this context", async () => {
    const provider = new OpenAIAnalystProvider({
      apiKey: "synthetic-openai-key",
      model: "gpt-synthetic",
      fetch: async () => completedResponse({
        ...answer,
        answer: { ...answer.answer, evidence: ["driver.99"] },
      }),
    });

    await expect(provider.generate(context)).rejects.toMatchObject({
      code: "invalid-provider-output",
      message: "OpenAI returned an invalid portfolio analyst answer.",
    });
  });

  it("maps provider transport details to a safe local error", async () => {
    const provider = new OpenAIAnalystProvider({
      apiKey: "synthetic-openai-key",
      model: "gpt-synthetic",
      fetch: async () => new Response("private provider response", { status: 429 }),
    });

    await expect(provider.generate(context)).rejects.toMatchObject({
      code: "provider-unavailable",
      message: "OpenAI could not generate a portfolio analyst answer.",
    });
  });
});
