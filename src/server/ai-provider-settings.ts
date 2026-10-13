import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const aiProviderSettingsSchema = z.object({
  model: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/),
  apiKey: z.string().trim().min(1).max(1024).regex(/^[\x21-\x7e]+$/).nullable().optional(),
}).strict();
export type StoredAIProviderSettings = z.infer<typeof aiProviderSettingsSchema>;
export interface AIProviderSettingsStore {
  read(): StoredAIProviderSettings | undefined;
  save(settings: StoredAIProviderSettings): void;
}

export function createAIProviderSettingsStore(
  filename = join(process.cwd(), "data", "ai-provider-settings.json"),
): AIProviderSettingsStore {
  return {
    read() {
      try { return aiProviderSettingsSchema.parse(JSON.parse(readFileSync(filename, "utf8"))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw new Error("AI settings could not be read.");
      }
    },
    save(settings) {
      const parsed = aiProviderSettingsSchema.parse(settings);
      mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(parsed), { flag: "wx", mode: 0o600 });
        renameSync(temporary, filename);
      } finally {
        try { unlinkSync(temporary); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("AI settings could not be saved.");
        }
      }
    },
  };
}

/** Explicit environments stay isolated for tests; production reads fresh settings on each request. */
export function getAIEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  settings = environment === process.env ? createAIProviderSettingsStore().read() : undefined,
): Readonly<Record<string, string | undefined>> {
  if (!settings) return environment;
  return {
    ...environment,
    ...(settings.apiKey !== undefined ? { OPENAI_API_KEY: settings.apiKey ?? undefined } : {}),
    OPENAI_ANALYST_MODEL: settings.model,
    OPENAI_NARRATIVE_MODEL: settings.model,
    OPENAI_MARKET_INTELLIGENCE_MODEL: settings.model,
    OPENAI_IMAGE_IMPORT_MODEL: settings.model,
    OPENAI_IMAGE_QUESTION_MODEL: settings.model,
  };
}

export function publicAIProviderSettings(environment: Readonly<Record<string, string | undefined>>, saved?: StoredAIProviderSettings) {
  const effective = getAIEnvironment(environment, saved);
  const hasApiKey = Boolean(effective.OPENAI_API_KEY?.trim());
  return { provider: "openai" as const,
    model: effective.OPENAI_ANALYST_MODEL?.trim() || effective.OPENAI_NARRATIVE_MODEL?.trim() || "gpt-6-luna",
    hasApiKey, keySource: !hasApiKey ? "none" as const : saved?.apiKey ? "settings" as const : "environment" as const,
  };
}
