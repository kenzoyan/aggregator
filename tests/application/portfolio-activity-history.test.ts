import { expect, it } from "vitest";
import { holdingUpdateHistory } from "@/application/portfolio-activity-history";
import { buildPortfolioState } from "@/domain/portfolio/ledger";
import type { PortfolioFacts } from "@/infrastructure/sqlite/portfolio-repository-contract";
import type { OpeningSnapshotInput, PortfolioEventInput } from "@/domain/portfolio/types";

function facts(openingSnapshots: OpeningSnapshotInput[], events: PortfolioEventInput[] = []): PortfolioFacts {
  return { openingSnapshots, events, confirmedImports: [], confirmedSnapshots: [], state: buildPortfolioState({ openingSnapshots, events }) };
}
const snapshot: OpeningSnapshotInput = { id: "initial", sourceAccountId: "account", asOf: "2020-01-01T00:00:00Z", positions: [
  { instrumentId: "fund", quantity: "10", costBasis: "100", currency: "EUR" },
] };
const updated = (id: string, day: string, quantity: string, costBasis: string): OpeningSnapshotInput => ({
  ...snapshot, id, asOf: `2020-01-${day}T00:00:00Z`, positions: [{ ...snapshot.positions[0], quantity, costBasis }],
});

it("shows initial holdings and later added units, excluding unchanged imports and other accounts", () => {
  const result = holdingUpdateHistory(facts([snapshot, updated("same", "02", "10", "100"), updated("added", "03", "15", "150")]), "account");
  expect(result.map((row) => [row.type, row.quantity, row.amount.amount])).toEqual([
    ["Holding created", "10", "100"], ["Units added", "5", "50"],
  ]);
  expect(holdingUpdateHistory(facts([snapshot]), "other")).toEqual([]);
});

it("does not invent another change when a snapshot absorbs an already recorded sale", () => {
  const sale: PortfolioEventInput = { id: "sale", type: "sale", sourceAccountId: "account", instrumentId: "fund",
    asOf: "2020-01-02T00:00:00Z", quantity: "2", proceeds: { amount: "20", currency: "EUR" }, destination: { kind: "external-account", name: "Bank" } };
  expect(holdingUpdateHistory(facts([snapshot, updated("after-sale", "03", "8", "80")], [sale]), "account")).toHaveLength(1);
});

it("does not call a quantity correction a sale and keeps cost-only changes", () => {
  const result = holdingUpdateHistory(facts([snapshot, updated("corrected", "02", "9", "90"), updated("cost", "03", "9", "95")]), "account");
  expect(result.slice(1).map((row) => [row.type, row.quantity, row.amount.amount])).toEqual([
    ["Holding updated", "-1", "-10"], ["Holding updated", "0", "5"],
  ]);
});

it("uses the imported sale record once instead of duplicating its snapshot change", () => {
  const after = updated("after-sale", "02", "8", "80");
  const sale: PortfolioEventInput = { id: "sale", type: "sale", sourceAccountId: "account", instrumentId: "fund",
    sourceImportId: "import", asOf: after.asOf, quantity: "2", proceeds: { amount: "20", currency: "EUR" },
    importUndo: { snapshotId: after.id, positionBefore: snapshot.positions[0], retainedCash: { amount: "0", currency: "EUR" } } };
  expect(holdingUpdateHistory(facts([snapshot, after], [sale]), "account")).toHaveLength(1);
});

it("keeps each holding's history separate and cash history limited to its currency", async () => {
  const { createCashActivityReadModel } = await import("@/application/portfolio-cash-activity");
  const { selectHoldingActivity } = await import("@/application/portfolio-activity-selection");
  const opening: OpeningSnapshotInput = { ...snapshot, portfolioCash: { amount: "100", currency: "EUR" }, positions: [
    ...snapshot.positions, { ...snapshot.positions[0], instrumentId: "other-fund" },
  ] };
  const events: PortfolioEventInput[] = [
    { id: "fund-sale", type: "sale", sourceAccountId: "account", instrumentId: "fund", asOf: "2020-01-02T00:00:00Z", quantity: "1", proceeds: { amount: "10", currency: "EUR" } },
    { id: "other-sale", type: "sale", sourceAccountId: "account", instrumentId: "other-fund", asOf: "2020-01-02T01:00:00Z", quantity: "1", proceeds: { amount: "10", currency: "EUR" } },
    { id: "withdraw", type: "cash-withdrawal", sourceAccountId: "account", asOf: "2020-01-03T00:00:00Z", amount: { amount: "20", currency: "EUR" }, destination: { kind: "external-account", name: "Bank" } },
  ];
  const activity = createCashActivityReadModel(facts([opening], events), "account");
  for (const instrumentId of ["fund", "other-fund"]) {
    const selected = selectHoldingActivity(activity, { instrumentId });
    expect(selected.records.map((record) => record.id)).toEqual([instrumentId === "fund" ? "fund-sale" : "other-sale"]);
    expect(selected.updates.map((record) => record.instrumentId)).toEqual([instrumentId]);
  }
  expect(selectHoldingActivity(activity, { cashCurrency: "EUR" }).records.map((record) => record.id)).toEqual(["withdraw"]);
  expect(selectHoldingActivity(activity, { cashCurrency: "CNY" }).records).toEqual([]);
  expect(selectHoldingActivity(activity, {}).records).toEqual([]);
  expect(selectHoldingActivity(activity, {}).updates).toEqual([]);
});
