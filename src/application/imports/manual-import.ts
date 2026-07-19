import type { ImportDraftInput } from "@/infrastructure/sqlite/portfolio-repository";

export function createManualImportDraft(input: {
  draftId: string;
  snapshotId: string;
  sourceAccountId: string;
  createdAt: string;
}): ImportDraftInput {
  return {
    id: input.draftId,
    sourceAccountId: input.sourceAccountId,
    sourceKind: "manual",
    createdAt: input.createdAt,
    confidence: "manual",
    warnings: ["Manual draft: enter each value and review it before confirmation."],
    proposedOpeningSnapshot: {
      id: input.snapshotId,
      sourceAccountId: input.sourceAccountId,
      asOf: input.createdAt,
      positions: [],
    },
  };
}
