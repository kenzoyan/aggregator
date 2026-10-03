import { describe, expect, it } from "vitest";

import {
  importDateFollowUpEdit,
  importDateClarificationQuestion,
  looksLikeImportDateAnswer,
  nextImportDateFollowUp,
  parseImportCodeReply,
  parseImportDateAnswer,
} from "@/application/imports/import-chat-follow-up";
import type { ImportDraftReadModel } from "@/application/imports/import-draft-read-model";

const draft = {
  id: "draft-1", sourceAccountId: "wechat-main", sourceKind: "screenshot",
  status: "draft", createdAt: "2026-10-03T10:00:00.000Z",
  confidence: "high", warnings: [],
  portfolio: { snapshotId: "snapshot-1", asOf: "", holdings: [{
    lineId: "holding-1", instrumentId: "fund-1", displayName: "Fund A",
    quantity: "1", currency: "CNY", costBasis: "10", observedPrice: "1.25",
  }] },
} satisfies ImportDraftReadModel;

describe("import follow-up dates", () => {
  it("asks for the account date before a missing fund price date", () => {
    const accountDate = nextImportDateFollowUp(draft)!;
    expect(accountDate.field).toBe("valuation-date");
    expect(importDateFollowUpEdit(accountDate, "2026-09-22")).toEqual({ type: "update-as-of", value: "2026-09-22" });
    const priceDate = nextImportDateFollowUp({ ...draft, portfolio: {
      ...draft.portfolio, asOf: "2026-09-22T00:00:00.000Z",
    } })!;
    expect(priceDate).toMatchObject({ field: "price-date", holdingLineId: "holding-1" });
    expect(importDateFollowUpEdit(priceDate, "2026-09-21")).toEqual({
      type: "update-holding", index: 0, field: "priceAsOf", value: "2026-09-21",
    });
  });

  it("normalizes common full-date replies without sending them back to ordinary chat", () => {
    expect(parseImportDateAnswer("2026-09-22")).toBe("2026-09-22");
    expect(parseImportDateAnswer("2026 10 02")).toBe("2026-10-02");
    expect(parseImportDateAnswer("2026/10/2")).toBe("2026-10-02");
    expect(parseImportDateAnswer("2026年10月2日")).toBe("2026-10-02");
    expect(parseImportDateAnswer("2 Oct 2026")).toBe("2026-10-02");
    expect(parseImportDateAnswer("October 2, 2026")).toBe("2026-10-02");
    expect(parseImportDateAnswer("The date is 2026-10-02")).toBe("2026-10-02");
    expect(parseImportDateAnswer("日期是 2026年10月2日")).toBe("2026-10-02");
  });

  it("rejects impossible, partial and ambiguous dates for clarification", () => {
    expect(parseImportDateAnswer("2026-02-30")).toBeUndefined();
    expect(parseImportDateAnswer("09-22")).toBeUndefined();
    expect(parseImportDateAnswer("02/10/2026")).toBeUndefined();
    expect(parseImportDateAnswer("What happened on 2026-10-02? ")).toBeUndefined();
    expect(looksLikeImportDateAnswer("09-22")).toBe(true);
    expect(looksLikeImportDateAnswer("2026-02-30")).toBe(true);
    expect(looksLikeImportDateAnswer("02/10/2026")).toBe(true);
    expect(looksLikeImportDateAnswer("2026 10 02")).toBe(true);
    expect(looksLikeImportDateAnswer("What did I import?")).toBe(false);
    expect(importDateClarificationQuestion("03 10 2026", "en"))
      .toContain("2026-03-10 or 2026-10-03");
  });

  it("assigns a supplied code to the only identifiable draft holding", () => {
    expect(parseImportCodeReply("and code/isin is TEST123456", draft)).toEqual({
      kind: "edit", holdingLineId: "holding-1", holdingIndex: 0,
      holdingLabel: "Fund A", value: "TEST123456",
    });
    expect(parseImportCodeReply("代码是 001234", draft)).toMatchObject({ kind: "edit", value: "001234" });
    expect(parseImportCodeReply("What is the code?", draft)).toBeUndefined();
    expect(parseImportCodeReply("code is TEST123456", {
      ...draft, portfolio: { ...draft.portfolio, holdings: [
        ...draft.portfolio.holdings,
        { ...draft.portfolio.holdings[0]!, lineId: "holding-2", displayName: "Fund B" },
      ] },
    })).toEqual({ kind: "needs-holding", value: "TEST123456" });
  });
});
