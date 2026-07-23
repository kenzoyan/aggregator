import type { Period } from "@/application/portfolio-read-model";

type RangePeriod = Exclude<Period, "today">;

const dayMs = 86_400_000;
const periodDays: Record<RangePeriod, number> = {
  week: 7,
  month: 30,
};
const toleranceDays: Record<RangePeriod, number> = {
  week: 3,
  month: 7,
};

export function selectRangeBaseline<T extends { asOf: string }>(input: {
  period: RangePeriod;
  points: readonly T[];
  asOf: string;
  monitoringStartedAt?: string;
}): { point: T; coverage?: "partial" } | undefined {
  const cutoff = new Date(
    new Date(input.asOf).getTime() - periodDays[input.period] * dayMs,
  );
  const tolerance = toleranceDays[input.period] * dayMs;
  const prior = [...input.points]
    .reverse()
    .find((point) => new Date(point.asOf) <= cutoff);
  if (
    prior &&
    cutoff.getTime() - new Date(prior.asOf).getTime() <= tolerance
  ) {
    return { point: prior };
  }

  const next = input.points.find((point) => new Date(point.asOf) >= cutoff);
  if (
    next &&
    new Date(next.asOf).getTime() - cutoff.getTime() <= tolerance
  ) {
    return { point: next };
  }

  const earliest = input.points.at(0);
  return earliest &&
      input.monitoringStartedAt &&
      new Date(input.monitoringStartedAt) > cutoff
    ? { point: earliest, coverage: "partial" }
    : undefined;
}
