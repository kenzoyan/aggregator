import type {
  ImportSourceKind,
  ImportUpdateMode,
} from "@/domain/import-draft";

export interface ImportLifecyclePolicy {
  updateMode: ImportUpdateMode;
  reviewScope: "complete-account" | "detected-holdings";
  preserveOmittedOnConfirmation: boolean;
}

const importLifecyclePolicies: Record<ImportSourceKind, ImportLifecyclePolicy> = {
  "trading-212": {
    updateMode: "complete",
    reviewScope: "complete-account",
    preserveOmittedOnConfirmation: false,
  },
  csv: {
    updateMode: "partial",
    reviewScope: "complete-account",
    preserveOmittedOnConfirmation: false,
  },
  manual: {
    updateMode: "partial",
    reviewScope: "complete-account",
    preserveOmittedOnConfirmation: false,
  },
  screenshot: {
    updateMode: "partial",
    reviewScope: "detected-holdings",
    preserveOmittedOnConfirmation: true,
  },
  demo: {
    updateMode: "partial",
    reviewScope: "detected-holdings",
    preserveOmittedOnConfirmation: false,
  },
};

export const legacyPartialSnapshotWarningMarker =
  "Previously confirmed holdings were included in this review. Removing one records that it is no longer held.";

export const completedPartialImportReviewWarning =
  legacyPartialSnapshotWarningMarker;

export const partialImportPreservationWarning =
  "This partial update shows only detected holdings. Other confirmed holdings stay unchanged.";

export function importLifecyclePolicyFor(
  sourceKind: ImportSourceKind,
): ImportLifecyclePolicy {
  return importLifecyclePolicies[sourceKind];
}
