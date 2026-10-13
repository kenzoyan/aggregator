import { aiProviderSettingsSchema, createAIProviderSettingsStore, publicAIProviderSettings, type AIProviderSettingsStore } from "@/server/ai-provider-settings";

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
});

export function createAIProviderSettingsHandlers(store: AIProviderSettingsStore, environment: Readonly<Record<string, string | undefined>> = process.env) {
  return {
    async GET() {
      try { return json(publicAIProviderSettings(environment, store.read())); }
      catch { return json({ error: "AI settings could not be loaded." }, 500); }
    },
    async PATCH(request: Request) {
      // Only the app's own page may save credentials. No user-controlled redirect or API host.
      if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
        return json({ error: "Save AI settings from this app's Settings page." }, 403);
      }
      if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "JSON settings are required." }, 415);
      try {
        const body = await request.text();
        if (body.length > 8192) return json({ error: "Settings are too large." }, 413);
        let value: unknown;
        try { value = JSON.parse(body); } catch { return json({ error: "Invalid settings." }, 400); }
        const result = aiProviderSettingsSchema.safeParse(value);
        if (!result.success) return json({ error: "Enter a valid model ID and API key." }, 400);
        const previous = store.read();
        const next = { ...previous, ...result.data };
        store.save(next);
        return json(publicAIProviderSettings(environment, next));
      } catch { return json({ error: "AI settings could not be saved." }, 500); }
    },
  };
}

export async function GET() { return createAIProviderSettingsHandlers(createAIProviderSettingsStore()).GET(); }
export async function PATCH(request: Request) { return createAIProviderSettingsHandlers(createAIProviderSettingsStore()).PATCH(request); }
