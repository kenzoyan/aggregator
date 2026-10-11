import { holdingUpdateHistory } from "@/application/portfolio-activity-history";
import type { PortfolioChartEventReadModel, PortfolioValuePointReadModel } from "@/application/portfolio-read-model";
import type { PortfolioOverviewInput } from "@/application/portfolio-overview";

/** Recorded transactions and confirmed updates; snapshot differences are not inferred purchases. */
export function createPortfolioChartEvents(input: PortfolioOverviewInput): PortfolioChartEventReadModel[] {
  const snapshots = input.snapshots.filter((snapshot) => snapshot.asOf <= input.asOf);
  const facts = { openingSnapshots: snapshots, events: input.events.filter((event) => event.asOf <= input.asOf) };
  const account = (id: string) => input.accountLabels[id] ?? id;
  const recorded = facts.events.filter((event) => !event.voidedAt).map((event): PortfolioChartEventReadModel => {
    const name = event.type === "sale"
      ? snapshots.filter((snapshot) => snapshot.sourceAccountId === event.sourceAccountId && snapshot.asOf <= event.asOf)
        .toSorted((a, b) => b.asOf.localeCompare(a.asOf))
        .flatMap((snapshot) => snapshot.positions.filter((position) => position.instrumentId === event.instrumentId))
        .at(0)?.displayName ?? event.instrumentId
      : undefined;
    return {
      id: event.id, asOf: event.asOf, sourceAccountId: event.sourceAccountId, account: account(event.sourceAccountId),
      ...(event.type === "sale" ? { holdingId: `${event.sourceAccountId}:${event.instrumentId}` } : {}),
      kind: event.type === "sale" ? "sale" : "withdrawal",
      label: event.type === "sale" ? `Sold · ${name}` : "Cash transferred out",
      amount: event.type === "sale" ? event.proceeds : event.amount,
      note: event.destination?.kind === "external-account"
        ? `To ${event.destination.name} · outside tracked portfolio`
        : "Proceeds remain in the investment account",
    };
  });
  const updates = [...new Set(snapshots.map((snapshot) => snapshot.sourceAccountId))].flatMap((id) => {
    const first = snapshots.filter((snapshot) => snapshot.sourceAccountId === id)
      .toSorted((a, b) => a.asOf.localeCompare(b.asOf)).at(0)!;
    return holdingUpdateHistory(facts, id)
      .filter((update) => update.asOf > first.asOf)
      .map((update): PortfolioChartEventReadModel => ({
        id: update.id, asOf: update.asOf, sourceAccountId: id, account: account(id),
        holdingId: `${id}:${update.instrumentId}`,
        kind: "holding-update", label: `${update.type} · ${update.holdingName}`,
        amount: update.amount, note: "Confirmed import · cost change, not a recorded trade amount",
      }));
  });
  return [...recorded, ...updates].sort((a, b) => a.asOf.localeCompare(b.asOf) || a.id.localeCompare(b.id));
}

/** Group events on the first valuation date on or after their date, within the displayed range. */
export function portfolioChartPointsWithEvents(
  timeline: readonly PortfolioValuePointReadModel[], events: readonly PortfolioChartEventReadModel[],
) {
  const points = timeline.map((point) => ({ ...point, events: [] as PortfolioChartEventReadModel[] }));
  const first = points.at(0)?.asOf;
  const last = points.at(-1)?.asOf;
  if (!first || !last) return points;
  for (const event of events) {
    const date = event.asOf.slice(0, 10);
    if (date < first || date > last) continue;
    points.find((point) => point.asOf >= date)?.events.push(event);
  }
  return points;
}
