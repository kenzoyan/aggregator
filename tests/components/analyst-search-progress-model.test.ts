import { describe, expect, it } from "vitest";
import { currentActivityState, latestToolActivities, researchProgress, researchWebsites } from "@/components/analyst-search-progress-model";
import type { PortfolioAnalystToolActivity } from "@/application/portfolio-analyst-agent";

const start = (id: string): PortfolioAnalystToolActivity => ({ toolCallId: id, name: "search_web", input: {}, stage: "started" });
const done = (id: string, urls: string[]): PortfolioAnalystToolActivity => ({ toolCallId: id, name: "search_web", input: {}, stage: "completed", evidenceCount: urls.length, sourceUrls: urls, researchStatus: "completed" });

describe("research progress", () => {
  it("keeps one chronological row per tool and updates its result without moving the row", () => {
    const activities = [start("a"), start("b"), done("b", ["https://example.org/b"]), done("a", ["https://example.org/a"])];
    const rows = latestToolActivities(activities);
    expect(rows.map((row) => row.toolCallId)).toEqual(["a", "b"]);
    expect(rows).toEqual([activities[3], activities[2]]);
    expect(latestToolActivities([...activities, start("c")]).map((row) => row.toolCallId)).toEqual(["a", "b", "c"]);
  });
  it("uses one current phase, prioritizes live search, then returns to answer generation", () => {
    const searching = researchProgress([start("a")], false);
    expect(currentActivityState("reading-current-facts", searching)).toBe("searching");
    expect(currentActivityState("generating-answer", searching)).toBe("searching");
    const finished = researchProgress([done("a", ["https://example.org/a"])], false);
    expect(currentActivityState("generating-answer", finished)).toBe("generating-answer");
    expect(currentActivityState("reading-current-facts", finished)).toBe("reading-current-facts");
    expect(currentActivityState("stopped", searching)).toBe("stopped");
    expect(currentActivityState("failed", searching)).toBe("failed");
    expect(currentActivityState("completed", finished)).toBe("completed");
  });
  it("merges repeated activity and keeps real returned websites during the next search", () => {
    const result = researchProgress([start("a"), done("a", ["https://www.reuters.com/article/1"]), start("b")], false);
    expect(result.state).toBe("searching");
    expect(result.sites).toEqual([{ label: "reuters.com", url: "https://www.reuters.com/article/1" }]);
    expect(researchProgress([start("a"), done("a", ["https://www.reuters.com/article/1"])], false).state).toBe("completed");
  });
  it("deduplicates websites while preserving the exact first source page", () => {
    expect(researchWebsites(["https://www.reuters.com/a?x=1", "https://reuters.com/b", "https://example.org/story"])).toEqual([
      { label: "reuters.com", url: "https://www.reuters.com/a?x=1" }, { label: "example.org", url: "https://example.org/story" },
    ]);
  });
  it("rejects unsafe and malformed links", () => {
    expect(researchWebsites(["javascript:alert(1)", "http://example.org", "https://user:pass@example.org", "invalid"])).toEqual([]);
  });
  it("does not invent websites before a search returns", () => {
    expect(researchProgress([start("a")], false)).toMatchObject({ state: "searching", sites: [] });
  });
  it("ends the active animation after interruption without discarding earlier sources", () => {
    expect(researchProgress([done("a", ["https://example.org/a"]), start("b")], true)).toMatchObject({ state: "interrupted", sites: [{ label: "example.org" }] });
  });
  it("distinguishes an empty result from an unavailable search", () => {
    expect(researchProgress([done("a", [])], false).state).toBe("empty");
    expect(researchProgress([{ ...done("a", []), researchStatus: "unavailable" }], false).state).toBe("unavailable");
  });
  it("supports saved audits and earlier records without website metadata", () => {
    expect(researchProgress([{ toolCallId: "a", name: "search_web", input: {}, status: "completed", evidenceKeys: ["web.1"], sourceUrls: ["https://example.org/a"] }], false).state).toBe("completed");
    expect(researchProgress([{ toolCallId: "a", name: "search_web", input: {}, status: "completed", evidenceKeys: ["web.1"] }], false).state).toBe("unknown");
  });
  it("does not label a finished search as stopped when the later answer fails", () => {
    expect(researchProgress([done("a", ["https://example.org/a"])], true).state).toBe("completed");
  });
  it("does not show research for unrelated portfolio tools", () => {
    expect(researchProgress([{ toolCallId: "a", name: "read_period_drivers", input: { period: "week" }, stage: "started" }], false).visible).toBe(false);
  });
});
