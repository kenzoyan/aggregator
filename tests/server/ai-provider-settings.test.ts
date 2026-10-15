import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAIProviderSettingsStore, getAIEnvironment } from "@/server/ai-provider-settings";
import { createAIProviderSettingsHandlers } from "@/app/api/settings/ai-provider/handler";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "aggregator-ai-settings-")); directories.push(directory);
  const filename = join(directory, "settings.json");
  const store = createAIProviderSettingsStore(filename);
  return { store, filename, handlers: createAIProviderSettingsHandlers(store, { OPENAI_API_KEY: "synthetic-env-key" }) };
}
function request(value: unknown, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/settings/ai-provider", { method: "PATCH", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(value) });
}
it("saves privately, survives a fresh store, replaces keys, and never reads the key back to the browser", async () => {
  const { store, filename, handlers } = setup();
  expect(store.read()).toBeUndefined();
  const response = await handlers.PATCH(request({ model: " model-one ", apiKey: " synthetic-key " }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ provider: "openai", model: "model-one", hasApiKey: true, keySource: "settings" });
  expect(statSync(filename).mode & 0o777).toBe(0o600);
  expect(createAIProviderSettingsStore(filename).read()).toEqual({ model: "model-one", apiKey: "synthetic-key" });
  await handlers.PATCH(request({ model: "model-two" }));
  expect(store.read()?.apiKey).toBe("synthetic-key");
  await handlers.PATCH(request({ model: "model-two", apiKey: "replacement" }));
  expect(store.read()?.apiKey).toBe("replacement");
  expect(await (await handlers.GET()).text()).not.toContain("replacement");
  await handlers.PATCH(request({ model: "model-two", apiKey: null }));
  expect(readFileSync(filename, "utf8")).not.toContain("replacement");
  expect(await (await handlers.GET()).json()).toMatchObject({ hasApiKey: false, keySource: "none" });
});
it("resolves Settings for every model role, preserves legacy configuration and isolates explicit test environments", () => {
  const environment = { OPENAI_API_KEY: "env-key", OPENAI_IMAGE_IMPORT_MODEL: "legacy-vision" };
  expect(getAIEnvironment(environment)).toBe(environment);
  const resolved = getAIEnvironment(environment, { model: "selected", apiKey: "saved-key" });
  for (const name of ["ANALYST", "NARRATIVE", "MARKET_INTELLIGENCE", "IMAGE_IMPORT", "IMAGE_QUESTION"]) expect(resolved[`OPENAI_${name}_MODEL`]).toBe("selected");
  expect(resolved.OPENAI_API_KEY).toBe("saved-key");
  expect(getAIEnvironment(environment, { model: "selected", apiKey: null }).OPENAI_API_KEY).toBeUndefined();
});
it("keeps the environment key when saving only a model and blocks writes without a same-origin header", async () => {
  const { handlers, store } = setup();
  expect(await (await handlers.PATCH(request({ model: "chosen-model" }))).json()).toMatchObject({ model: "chosen-model", hasApiKey: true, keySource: "environment" });
  const missingOrigin = new Request("http://localhost:3000/api/settings/ai-provider", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "changed" }) });
  expect((await handlers.PATCH(missingOrigin)).status).toBe(403);
  expect(store.read()?.model).toBe("chosen-model");
});
it("reports storage failures without exposing keys or filesystem details", async () => {
  const fail = () => { throw new Error("synthetic-secret /private/local-file"); };
  const handlers = createAIProviderSettingsHandlers({ read: fail, save: fail }, {});
  const read = await handlers.GET();
  expect(read.status).toBe(500); expect(await read.text()).not.toContain("synthetic-secret");
  const write = await handlers.PATCH(request({ model: "one", apiKey: "synthetic-secret" }));
  expect(write.status).toBe(500); expect(await write.text()).not.toContain("synthetic-secret");
});
it("rejects cross-origin writes, malformed or oversized settings without leaking inputs or changing configuration", async () => {
  const { handlers, store } = setup();
  expect((await handlers.PATCH(request({ model: "one", apiKey: "secret" }, "https://other.test"))).status).toBe(403);
  for (const value of [{ model: "", apiKey: "secret" }, { model: "one", apiKey: "has spaces" }, { model: "one", extra: "secret" }]) {
    const response = await handlers.PATCH(request(value)); expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("secret");
  }
  expect((await handlers.PATCH(request({ model: "one", apiKey: "x".repeat(9000) }))).status).toBe(413);
  expect(store.read()).toBeUndefined();
});
