/** Token-based estimate, not an invoice. Standard GPT-6 Luna rates checked 2026-10-10. */
export function responseUsageReport(envelope: Record<string, any>, requestedModel: string) {
  const usage = envelope.usage;
  const model = envelope.model ?? requestedModel;
  const webSearchCalls = (envelope.output ?? []).filter((item: { type?: string }) => item.type === "web_search_call").length;
  if (!usage) return { model, usageAvailable: false, webSearchCalls, estimatedUsd: null };
  const inputTokens = usage.input_tokens ?? 0;
  const cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0;
  const cacheWriteTokens = usage.input_tokens_details?.cache_write_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const inputRate = inputTokens > 272_000 ? 0.20 : 0.10;
  const outputRate = inputTokens > 272_000 ? 0.75 : 0.50;
  const estimatedUsd = model.startsWith("gpt-6-luna")
    ? (Math.max(0, inputTokens - cachedTokens - cacheWriteTokens) * inputRate + cachedTokens * (inputRate / 10) + cacheWriteTokens * (inputRate * 1.25) + outputTokens * outputRate) / 1_000_000 + webSearchCalls * 0.01
    : null;
  return { model, usageAvailable: true, inputTokens, cachedTokens, cacheWriteTokens, outputTokens, webSearchCalls, estimatedUsd };
}

export const defaultApiTestBudget = { maxRequests: 12, maxEstimatedUsd: 0.10 };

export function measureApiUsage(fetchImpl = globalThis.fetch, budget = defaultApiTestBudget) {
  const requests: Array<Record<string, any>> = [];
  const pending: Promise<void>[] = [];
  let blockedReason: string | undefined;
  const measuredFetch: typeof fetch = async (url, options) => {
    const body = typeof options?.body === "string" ? JSON.parse(options.body) : {};
    await Promise.all(pending);
    const spent = requests.reduce((sum, request) => sum + (request.estimatedUsd ?? 0), 0);
    // Conservative bound: one input token per serialized byte, the output limit,
    // and every allowed web-search call. Unknown models require a reviewed budget.
    const estimatedNextMax = body.model?.startsWith("gpt-6-luna")
      ? new TextEncoder().encode(JSON.stringify(body)).byteLength * 0.125 / 1_000_000 +
        (body.max_output_tokens ?? 8000) * 0.50 / 1_000_000 +
        (body.tools?.some((tool: { type?: string }) => tool.type === "web_search") ? (body.max_tool_calls ?? 3) * 0.01 : 0)
      : null;
    if (requests.length >= budget.maxRequests) blockedReason = "API request limit reached; owner approval required.";
    else if (estimatedNextMax === null || requests.some((request) => !request.usageAvailable)) blockedReason = "Usage or pricing unavailable; owner approval required.";
    else if (spent + estimatedNextMax > budget.maxEstimatedUsd) blockedReason = "Estimated API cost limit reached; owner approval required.";
    if (blockedReason) throw new Error(blockedReason);
    const record: Record<string, any> = { model: body.model, usageAvailable: false, estimatedUsd: null };
    requests.push(record);
    const started = Date.now();
    try {
      const response = await fetchImpl(url, options);
      record.httpStatus = response.status;
      pending.push(response.clone().text().then((text) => {
        let envelope: Record<string, any> | undefined;
        if (body.stream) {
          for (const line of text.split(/\r?\n/)) {
            if (!line.startsWith("data:") || line.slice(5).trim() === "[DONE]") continue;
            const event = JSON.parse(line.slice(5));
            if (event.response?.usage) envelope = event.response;
          }
        } else envelope = JSON.parse(text);
        if (envelope) Object.assign(record, responseUsageReport(envelope, body.model));
      }).catch(() => { record.usageAvailable = false; }).finally(() => { record.elapsedMs = Date.now() - started; }));
      return response;
    } catch (error) {
      record.elapsedMs = Date.now() - started;
      record.requestFailed = true;
      throw error;
    }
  };
  return { fetch: measuredFetch, async report() {
    await Promise.all(pending);
    return { budget, blockedReason, apiRequests: requests.length, usageComplete: requests.every((request) => request.usageAvailable),
      estimatedUsd: requests.some((request) => request.estimatedUsd === null) ? null : requests.reduce((sum, request) => sum + request.estimatedUsd, 0),
      requests };
  } };
}
