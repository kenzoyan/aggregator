import { expect, it, vi } from "vitest";
import { createOpenAISaleExtractor } from "@/infrastructure/openai/openai-sale-extractor";
const value = { status: "completed", accountName: null, name: "Synthetic Fund", symbol: "SYNTH", date: "2020-01-02",
  quantity: "2", gross: "30", net: "29", fees: "1", currency: "EUR",
  destination: null, destinationName: null, warnings: [] };
const completed = (output: unknown) => Response.json({ status: "completed",
  output: [{ content: [{ type: "output_text", text: JSON.stringify(output) }] }] });
it("sends a single image with strict structured output and validates missing destination", async () => {
  const fetch = vi.fn(async () => completed(value));
  const extract = createOpenAISaleExtractor({ apiKey: "synthetic-key", model: "synthetic-model", fetch });
  await expect(extract({ image: { bytes: new Uint8Array([1,2,3]), mimeType: "image/png" }, text: "Record sale",
    signal: new AbortController().signal })).resolves.toEqual(value);
  const [, request] = fetch.mock.calls[0] as unknown as [unknown, RequestInit];
  const payload = JSON.parse(String(request.body));
  expect(payload.store).toBe(false);
  expect(payload.input[0].content[1]).toMatchObject({ type: "input_image", image_url: "data:image/png;base64,AQID" });
  expect(payload.text.format).toMatchObject({ type: "json_schema", strict: true });
});
it("uses a text-only request for draft corrections and rejects invalid model money", async () => {
  const fetch = vi.fn(async () => completed({ ...value, fees: "-1" }));
  const extract = createOpenAISaleExtractor({ apiKey: "synthetic-key", model: "synthetic-model", fetch });
  await expect(extract({ text: "Change fee", current: { sourceAccountId: "a", instrumentId: "f", date: "2020-01-02",
    quantity: "2", amount: "29", amountType: "net", fees: "1", destination: "", destinationName: "" },
    signal: new AbortController().signal })).rejects.toThrow();
  const [, request] = fetch.mock.calls[0] as unknown as [unknown, RequestInit];
  expect(JSON.parse(String(request.body)).input[0].content).toHaveLength(1);
});
