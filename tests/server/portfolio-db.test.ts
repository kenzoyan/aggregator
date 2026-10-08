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
      saveImportDraftReview: vi.fn(),
      discardImportDraft: vi.fn(),
      readPriceSourceBindings: vi.fn(),
      savePriceSourceBinding: vi.fn(),
      listPortfolioAnalystMemories: vi.fn(),
      readPortfolioAnalystMemory: vi.fn(),
      savePortfolioAnalystMemory: vi.fn(),
      deletePortfolioAnalystMemory: vi.fn(),
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
      saveImportDraftReview: vi.fn(),
      discardImportDraft: vi.fn(),
      readPriceSourceBindings: vi.fn(),
      savePriceSourceBinding: vi.fn(),
      listPortfolioAnalystMemories: vi.fn(),
      readPortfolioAnalystMemory: vi.fn(),
      savePortfolioAnalystMemory: vi.fn(),
      deletePortfolioAnalystMemory: vi.fn(),
      confirmWithdrawal: vi.fn(),
      undoCashActivity: vi.fn(),
    };
    const create = vi.fn();

    expect(ensureCurrentPortfolioDatabase(current, create)).toBe(current);
    expect(current.close).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("replaces the cached sale implementation that predates destination support", () => {
    const current = {
      close: vi.fn(), readLatestMarketIntelligenceBrief: vi.fn(), saveMarketIntelligenceBrief: vi.fn(),
      deleteSourceAccount: vi.fn(), saveImportDraftReview: vi.fn(), discardImportDraft: vi.fn(),
      readPriceSourceBindings: vi.fn(), savePriceSourceBinding: vi.fn(),
      listPortfolioAnalystMemories: vi.fn(), readPortfolioAnalystMemory: vi.fn(),
      savePortfolioAnalystMemory: vi.fn(), deletePortfolioAnalystMemory: vi.fn(),
    };
    const replacement = { ...current, close: vi.fn(), confirmWithdrawal: vi.fn(), undoCashActivity: vi.fn() };
    expect(ensureCurrentPortfolioDatabase(current, () => replacement)).toBe(replacement);
    expect(current.close).toHaveBeenCalledOnce();
  });

  it("replaces an otherwise current hot-reload instance missing draft review persistence", () => {
    const close = vi.fn();
    const replacement = {
      close: vi.fn(),
      readLatestMarketIntelligenceBrief: vi.fn(),
      saveMarketIntelligenceBrief: vi.fn(),
      deleteSourceAccount: vi.fn(),
      saveImportDraftReview: vi.fn(),
      discardImportDraft: vi.fn(),
    };
    const current = {
      close,
      readLatestMarketIntelligenceBrief: vi.fn(),
      saveMarketIntelligenceBrief: vi.fn(),
      deleteSourceAccount: vi.fn(),
    };
    expect(ensureCurrentPortfolioDatabase(current, () => replacement)).toBe(replacement);
    expect(close).toHaveBeenCalledOnce();
  });

  it("replaces a hot-reload instance missing draft cancellation", () => {
    const close = vi.fn();
    const current = {
      close,
      readLatestMarketIntelligenceBrief: vi.fn(),
      saveMarketIntelligenceBrief: vi.fn(),
      deleteSourceAccount: vi.fn(),
      saveImportDraftReview: vi.fn(),
    };
    const replacement = { ...current, close: vi.fn(), discardImportDraft: vi.fn() };
    expect(ensureCurrentPortfolioDatabase(current, () => replacement)).toBe(replacement);
    expect(close).toHaveBeenCalledOnce();
  });

  it("replaces a hot-reload instance missing price source bindings", () => {
    const close = vi.fn();
    const current = {
      close,
      readLatestMarketIntelligenceBrief: vi.fn(),
      saveMarketIntelligenceBrief: vi.fn(),
      deleteSourceAccount: vi.fn(),
      saveImportDraftReview: vi.fn(),
      discardImportDraft: vi.fn(),
    };
    const replacement = {
      ...current,
      close: vi.fn(),
      readPriceSourceBindings: vi.fn(),
      savePriceSourceBinding: vi.fn(),
    };
    expect(ensureCurrentPortfolioDatabase(current, () => replacement)).toBe(replacement);
    expect(close).toHaveBeenCalledOnce();
  });
});
