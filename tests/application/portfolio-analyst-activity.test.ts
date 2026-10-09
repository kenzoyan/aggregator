import { expect, it } from "vitest";
import { createActivityHistoryContext } from "@/application/portfolio-analyst-activity";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import { createSourceAccountDefinition } from "@/domain/source-accounts";
import type { OpeningSnapshotInput, PortfolioEventInput } from "@/domain/portfolio/types";
import type { PortfolioFacts } from "@/infrastructure/sqlite/portfolio-repository-contract";

const account = createSourceAccountDefinition({ id: "account", accountType: "Test" });
const opening: OpeningSnapshotInput = { id: "opening", sourceAccountId: "account", asOf: "2026-01-01T00:00:00Z",
  positions: [{ instrumentId: "fund", instrumentCode: "123", displayName: "Fund", quantity: "10", costBasis: "100", currency: "EUR" }],
  portfolioCash: { amount: "50", currency: "EUR" } };
const sale: PortfolioEventInput = { id: "sale", type: "sale", sourceAccountId: "account", instrumentId: "fund",
  asOf: "2026-01-02T00:00:00Z", quantity: "2", proceeds: { amount: "30", currency: "EUR" },
  fees: { amount: "1", currency: "EUR" }, destination: { kind: "external-account", name: "Bank" } };
function facts(events: PortfolioEventInput[] = [sale], snapshots = [opening]): PortfolioFacts {
  return { openingSnapshots: snapshots, events, confirmedImports: [], confirmedSnapshots: [], state: buildPortfolioState({ openingSnapshots: snapshots, events }) };
}
function read(data: PortfolioFacts | undefined = facts(), extra: Record<string, string> = {}) {
  return createActivityHistoryContext({ accounts: [account], facts: data, factsAsOf: "2026-01-10T00:00:00Z",
    request: { accountType: "Test", holding: "123", language: "en", includeHoldingNames: true, ...extra } });
}

it("separates net external outflow from realized sale result and scopes holding records", () => {
  const result = read();
  expect(result.facts).toContainEqual(expect.objectContaining({
    activity: "sale", netProceeds: "29", soldCostBasis: "20", realizedResult: "9",
    destination: "external-account", destinationName: "Bank", excludedFromTrackedAssets: true,
  }));
  expect(result.facts).toContainEqual(expect.objectContaining({ activity: "holding-created" }));
  expect(result.allowedActions).toEqual([]);
});

it("reads fully sold holdings and dates without requiring a current position", () => {
  const full = { ...sale, quantity: "10" };
  const data = facts([full], [opening, { ...opening, id: "closed", asOf: "2026-01-03T00:00:00Z", positions: [] }]);
  expect(read(data, { fromDate: "2026-01-02", toDate: "2026-01-02" }).facts).toHaveLength(2);
  expect(() => read(data, { fromDate: "2026-01-03", toDate: "2026-01-01" })).toThrow();
});

it("marks undone sales and does not infer legacy destinations", () => {
  const legacy = { ...sale, destination: undefined, voidedAt: "2026-01-04T00:00:00Z" };
  expect(read(facts([legacy])).facts).toContainEqual(expect.objectContaining({
    activity: "sale", status: "undone", destinationKnown: false, excludedFromTrackedAssets: false,
  }));
});

it("rejects missing or ambiguous identities and distinguishes unavailable history", () => {
  expect(read(facts(), { holding: "unknown" }).facts[0]).toMatchObject({ status: "holding-not-found" });
  const sameName = { ...opening, positions: [...opening.positions, { ...opening.positions[0], instrumentId: "other" }] };
  expect(read(facts([], [sameName])).facts[0]).toMatchObject({ status: "holding-ambiguous" });
  expect(createActivityHistoryContext({ accounts: [account], factsAsOf: "2026-01-10",
    request: { accountType: "Test", language: "en", includeHoldingNames: true } }).facts[0]).toMatchObject({ status: "unavailable" });
});

it("bounds account history and includes withdrawals without mixing holding history", () => {
  const events: PortfolioEventInput[] = Array.from({ length: 25 }, (_, i) => ({
    id: `w${i}`, type: "cash-withdrawal", sourceAccountId: "account", asOf: `2026-01-${String(i + 2).padStart(2, "0")}T00:00:00Z`,
    amount: { amount: "1", currency: "EUR" }, destination: { kind: "external-account", name: "Bank" },
  }));
  const data = facts(events);
  const result = createActivityHistoryContext({ accounts: [account], facts: data, factsAsOf: "2026-01-30",
    request: { accountType: "Test", language: "en", includeHoldingNames: true } });
  expect(result.facts[0]).toMatchObject({ recordCount: 25, shownRecordCount: 20, coverage: "recorded-history-only" });
  expect(result.facts).toHaveLength(21);
  expect(read(data).facts).toHaveLength(2);
});

it("calculates successive sales from ledger state and imported sales from saved pre-import position", () => {
  const second = { ...sale, id: "second", asOf: "2026-01-03T00:00:00Z", quantity: "4" };
  expect(read(facts([sale, second])).facts[1]).toMatchObject({ soldCostBasis: "40", realizedResult: "-11" });
  const imported = { ...sale, sourceImportId: "import", importUndo: { snapshotId: "after",
    positionBefore: opening.positions[0], retainedCash: { amount: "0", currency: "EUR" } } };
  expect(read(facts([imported])).facts[1]).toMatchObject({ soldCostBasis: "20", source: "confirmed-import" });
});
