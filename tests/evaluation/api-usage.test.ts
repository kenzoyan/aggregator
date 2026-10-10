import { expect, it, vi } from "vitest";
import { measureApiUsage, responseUsageReport } from "./api-usage";

it("prices cached input separately and includes web searches", () => {
  expect(responseUsageReport({ model: "gpt-6-luna", usage: { input_tokens: 10000, input_tokens_details: { cached_tokens: 8000 }, output_tokens: 2000 }, output: [{ type: "web_search_call" }] }, "gpt-6-luna"))
    .toMatchObject({ estimatedUsd: 0.01128, webSearchCalls: 1, cachedTokens: 8000 });
  expect(responseUsageReport({ usage: { input_tokens: 10 } }, "unknown-model").estimatedUsd).toBeNull();
});

it("collects native streaming usage and stops before an additional request exceeds the gate", async () => {
  const fetchImpl = vi.fn(async () => new Response('data: {"type":"response.completed","response":{"model":"gpt-6-luna","usage":{"input_tokens":100,"output_tokens":20},"output":[]}}\n\ndata: [DONE]\n\n'));
  const measured = measureApiUsage(fetchImpl, { maxRequests: 1, maxEstimatedUsd: 0.10 });
  const request = { method: "POST", body: JSON.stringify({ model: "gpt-6-luna", stream: true, max_output_tokens: 100 }) };
  await measured.fetch("https://api.openai.com/v1/responses", request);
  await expect(measured.fetch("https://api.openai.com/v1/responses", request)).rejects.toThrow("approval required");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(await measured.report()).toMatchObject({ apiRequests: 1, usageComplete: true, estimatedUsd: 0.00002 });
});

it("blocks costly requests and refuses to assume missing usage is free", async () => {
  const fetchImpl = vi.fn(async () => Response.json({ output: [] }));
  const measured = measureApiUsage(fetchImpl, { maxRequests: 12, maxEstimatedUsd: 0.00001 });
  await expect(measured.fetch("https://api.openai.com/v1/responses", { body: JSON.stringify({ model: "gpt-6-luna", max_output_tokens: 8000 }) })).rejects.toThrow("cost limit");
  expect(fetchImpl).not.toHaveBeenCalled();
  const unknownUsage = measureApiUsage(fetchImpl);
  const request = { body: JSON.stringify({ model: "gpt-6-luna", max_output_tokens: 100 }) };
  await unknownUsage.fetch("https://api.openai.com/v1/responses", request);
  await expect(unknownUsage.fetch("https://api.openai.com/v1/responses", request)).rejects.toThrow("Usage or pricing unavailable");
  expect((await unknownUsage.report()).estimatedUsd).toBeNull();
});
