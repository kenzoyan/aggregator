import { describe, expect, it } from "vitest";

import {
  createAgentImportAnalysisForm,
  resolveAgentImportSourceAccount,
} from "../../src/components/agent-import-analysis";

const accounts = [
  {
    id: "wechat-main",
    accountType: "WeChat Wealth Management",
    label: "WeChat",
    updateMethod: "Screenshot" as const,
  },
  {
    id: "trading212-main",
    accountType: "Trading 212",
    label: "Trading 212",
    updateMethod: "Trading 212 API" as const,
  },
];

describe("Agent import analysis boundary", () => {
  it("resolves only a registered screenshot account", () => {
    expect(resolveAgentImportSourceAccount(accounts, " wechat-wealth management ")?.id)
      .toBe("wechat-main");
    expect(resolveAgentImportSourceAccount(accounts, "Trading 212")).toBeUndefined();
    expect(resolveAgentImportSourceAccount(accounts, "Unknown")).toBeUndefined();
  });

  it("builds the existing multipart analysis request without serializing files", () => {
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.webp", { type: "image/webp" });

    const form = createAgentImportAnalysisForm("wechat-main", [first, second]);

    expect(form.get("sourceAccountId")).toBe("wechat-main");
    expect(form.get("mode")).toBe("image");
    expect(form.getAll("images")).toEqual([first, second]);
  });
});
