export function holdingChartDomain(values: readonly number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [0, 1];

  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const padding = Math.max(
    (max - min) * 0.12,
    Math.max(Math.abs(min), Math.abs(max)) * 0.005,
    0.000001,
  );
  return [min >= 0 ? Math.max(0, min - padding) : min - padding, max + padding];
}
