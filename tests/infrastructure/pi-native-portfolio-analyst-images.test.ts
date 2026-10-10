import { expect, it } from "vitest";
import { createPiNativePortfolioAnalystRuntime } from "@/infrastructure/pi/pi-native-portfolio-analyst-runtime";

it("serializes historical and current original images into the actual OpenAI request", async () => {
  const requests: unknown[] = [];
  const fetchMock: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ error: { message: "Synthetic request rejected" } }), { status: 400, headers: { "content-type": "application/json" } });
  };
  const fail = () => { throw new Error("Unexpected portfolio read"); };
  const runtime = createPiNativePortfolioAnalystRuntime({ model: "synthetic-vision-model", apiKey: "synthetic-key", fetch: fetchMock });
  await expect(runtime.runTurn({ question: "Explain the second image", history: [
    { role: "user", text: "First image", images: [{ id: "first", data: "AQ==", mimeType: "image/png" }] },
    { role: "assistant", text: "First answer", factsAsOf: "2026-01-01" },
  ], images: [{ data: "Ag==", mimeType: "image/png" }], language: "en", includeHoldingNames: true, defaultPeriod: "week",
    tools: { readPeriodDrivers: fail, readDataQuality: fail, readPortfolioOverview: fail, readAllHoldings: fail,
      readAccounts: fail, readAccountHoldings: fail, readHoldingHistory: fail, readAccountActivity: fail,
      proposeCreateAccount: fail, prepareAccountImport: fail },
  })).rejects.toThrow();
  expect(requests).toHaveLength(1);
  const payload = JSON.stringify(requests[0]);
  expect(payload).toContain('"type":"input_image"');
  expect(payload).toContain("data:image/png;base64,AQ==");
  expect(payload).toContain("data:image/png;base64,Ag==");
  expect(payload).toContain("First answer");
});
