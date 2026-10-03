import { describe, expect, it, vi } from "vitest";

import type { ImportDraftReadModel } from "@/application/imports/import-draft-read-model";
import { createImportMessageInterpreter } from "@/infrastructure/responses/import-message-interpreter";

const draft = {
  id: "synthetic-draft", sourceAccountId: "synthetic-account", sourceKind: "screenshot", status: "draft",
  portfolio: { asOf: "2026-10-03", holdings: [{
    lineId: "synthetic-line", instrumentId: "SYNTH-1", displayName: "Synthetic Fund",
    quantity: "2", currency: "EUR", costBasis: "100", reportedMarketValue: "110",
  }] },
} as ImportDraftReadModel;

function response(decision: Record<string, unknown>) {
  return new Response(JSON.stringify({
    status: "completed", output: [{ content: [{ type: "output_text", text: JSON.stringify(decision) }] }],
  }), { status: 200 });
}

describe("import message interpreter", () => {
  it("sends draft context to the model and returns its selected action", async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => response({
      intent: "confirm", confidence: "high", field: null, value: null, holdingLineId: null, reply: null,
    }));
    const interpreter = createImportMessageInterpreter({
      provider: "openai", apiKey: "synthetic-key", model: "synthetic-model", fetch,
    });
    await expect(interpreter.interpret({
      message: "This all checks out, go ahead with the update", draft,
      language: "en", recentConversation: [{ role: "assistant", text: "Please review the draft." }],
    })).resolves.toEqual({ intent: "confirm" });
    const body = JSON.parse(String(fetch.mock.calls[0]![1]?.body));
    const context = JSON.parse(body.input[0].content[0].text);
    expect(context.holdings[0]).toMatchObject({
      lineId: "synthetic-line", quantity: "2", costBasis: "100", currentValue: "110",
    });
    expect(context.recentConversation).toHaveLength(1);
  });

  it("does not execute a low-confidence mutation", async () => {
    const interpreter = createImportMessageInterpreter({
      provider: "openai", apiKey: "synthetic-key", model: "synthetic-model",
      fetch: async () => response({
        intent: "confirm", confidence: "low", field: null, value: null, holdingLineId: null,
        reply: "Do you want me to apply this draft now?",
      }),
    });
    await expect(interpreter.interpret({
      message: "Maybe save this later", draft, language: "en", recentConversation: [],
    })).resolves.toEqual({ intent: "reply", reply: "Do you want me to apply this draft now?" });
  });
});
