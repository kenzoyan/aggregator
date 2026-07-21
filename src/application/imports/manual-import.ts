import {
  knownDraftValue,
  unknownDraftValue,
  type ImportDraftInput,
} from "@/domain/imports";

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
    portfolio: {
      snapshotId: input.snapshotId,
      asOf: knownDraftValue(input.createdAt, "manual"),
      portfolioCash: unknownDraftValue(),
      holdings: [],
    },
  };
}
