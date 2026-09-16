import { describe, expect, it, vi } from "vitest";

import { ensureCurrentPortfolioDatabase } from "@/server/portfolio-db";

describe("portfolio database singleton", () => {
  it("replaces a hot-reload instance that predates newly added repository methods", () => {
    const close = vi.fn();
    const replacement = {
      close: vi.fn(),
      readLatestMarketIntelligenceBrief: vi.fn(),
      saveMarketIntelligenceBrief: vi.fn(),
      deleteSourceAccount: vi.fn(),
    };
    const create = vi.fn(() => replacement);

    expect(ensureCurrentPortfolioDatabase({
      close,
      readLatestMarketIntelligenceBrief: vi.fn(),
      saveMarketIntelligenceBrief: vi.fn(),
    }, create)).toBe(replacement);
    expect(close).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });

  it("keeps a repository that already supports the current feature set", () => {
    const current = {
      close: vi.fn(),
      readLatestMarketIntelligenceBrief: vi.fn(),
      saveMarketIntelligenceBrief: vi.fn(),
      deleteSourceAccount: vi.fn(),
    };
    const create = vi.fn();

    expect(ensureCurrentPortfolioDatabase(current, create)).toBe(current);
    expect(current.close).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
