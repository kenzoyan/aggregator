import { describe, expect, it } from "vitest";

import { createManualImportDraft } from "@/application/imports/manual-import";

describe("manual import", () => {
  it("creates an editable draft without changing portfolio state", () => {
    const draft = createManualImportDraft({
      draftId: "draft-manual",
      snapshotId: "snapshot-manual",
      sourceAccountId: "wechat-main",
      createdAt: "2026-07-19T10:00:00.000Z",
    });

    expect(draft).toMatchObject({
      sourceAccountId: "wechat-main",
      sourceKind: "manual",
      confidence: "manual",
      portfolio: {
        snapshotId: "snapshot-manual",
        holdings: [],
      },
    });
  });
});
