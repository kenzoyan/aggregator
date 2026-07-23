export interface SparklineSeries {
  id: string;
  points: number[];
}

export interface ComparableSparklineModel {
  path: string;
  zeroY: number;
}

const chartTop = 12;
const chartBottom = 56;
const chartHeight = chartBottom - chartTop;

function percentChangePoints(points: readonly number[]): number[] {
  const baseline = points[0];
  if (baseline === undefined || baseline === 0) {
    return points.map(() => 0);
  }
  return points.map((point) =>
    Number((((point - baseline) / Math.abs(baseline)) * 100).toFixed(12))
  );
}

function yPosition(point: number, range: number): number {
  return chartBottom - ((point + range) / (range * 2)) * chartHeight;
}

function pathFor(points: readonly number[], range: number): string {
  return points
    .map((point, index) => {
      const x = points.length < 2 ? 0 : (index / (points.length - 1)) * 100;
      const y = yPosition(point, range);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function comparableSparklineModels(
  series: readonly SparklineSeries[],
): Record<string, ComparableSparklineModel> {
  const percentSeries = series.map((item) => ({
    id: item.id,
    points: percentChangePoints(item.points),
  }));
  const largestMove = Math.max(
    0,
    ...percentSeries.flatMap((item) => item.points.map((point) => Math.abs(point))),
  );
  const range = largestMove || 1;
  const zeroY = yPosition(0, range);
  return Object.fromEntries(
    percentSeries.map((item) => [
      item.id,
      {
        path: pathFor(item.points, range),
        zeroY,
      },
    ]),
  );
}
