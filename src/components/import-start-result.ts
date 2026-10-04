import type { ImportDraftReadModel } from "@/application/imports/import-draft-read-model";

export type ImportStartResult =
  | { outcome: "review-required"; draft: ImportDraftReadModel }
  | { outcome: "market-data-only"; message: string };

function isReviewDraft(value: unknown): value is ImportDraftReadModel {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  if (!draft.portfolio || typeof draft.portfolio !== "object" || Array.isArray(draft.portfolio)) return false;
  return typeof draft.id === "string" && draft.id.length > 0 &&
    typeof draft.sourceAccountId === "string" &&
    typeof draft.sourceKind === "string" && draft.status === "draft" &&
    Array.isArray((draft.portfolio as Record<string, unknown>).holdings);
}

export function parseImportStartResult(
  payload: unknown,
  responseOk: boolean,
  fallbackError: string,
): ImportStartResult {
  const result = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  if (!responseOk) {
    throw new Error(typeof result.error === "string" && result.error.trim()
      ? result.error
      : fallbackError);
  }
  if (result.outcome === "market-data-only" && typeof result.message === "string" && result.message.trim()) {
    return { outcome: "market-data-only", message: result.message };
  }
  if (result.outcome === "review-required" && isReviewDraft(result.draft)) {
    return { outcome: "review-required", draft: result.draft };
  }
  throw new Error(fallbackError);
}
