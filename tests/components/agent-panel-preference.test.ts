import { describe, expect, it } from "vitest";

import { readAgentPanelCollapsed, saveAgentPanelCollapsed } from "@/components/agent-panel-preference";

describe("agent panel preference", () => {
  it("starts expanded when no valid preference exists", () => {
    for (const value of [null, "", "expanded", "unexpected"]) {
      expect(readAgentPanelCollapsed(() => ({ getItem: () => value }))).toBe(false);
    }
  });

  it("restores collapse and expansion across page loads without changing other preferences", () => {
    const values = new Map([["unrelated", "keep"]]);
    const storage = () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
    saveAgentPanelCollapsed(storage, true);
    expect(readAgentPanelCollapsed(storage)).toBe(true);
    saveAgentPanelCollapsed(storage, false);
    expect(readAgentPanelCollapsed(storage)).toBe(false);
    expect(values.get("unrelated")).toBe("keep");
  });

  it("remains usable when browser storage access or writes are blocked", () => {
    const denied = () => { throw new Error("Storage denied"); };
    expect(readAgentPanelCollapsed(denied)).toBe(false);
    expect(() => saveAgentPanelCollapsed(denied, true)).not.toThrow();
    expect(() => saveAgentPanelCollapsed(() => ({ setItem: denied }), false)).not.toThrow();
  });
});
