const MAX_FRACTION_DIGITS = 4;

export function createPortfolioValueAxisFormatter(values: readonly number[]) {
  const finiteValues = values.filter(Number.isFinite);
  const span = finiteValues.length > 1
    ? Math.max(...finiteValues) - Math.min(...finiteValues)
    : 0;
  const approximateTickStep = span / 4;
  const fractionDigits = approximateTickStep > 0
    ? Math.min(
        MAX_FRACTION_DIGITS,
        Math.max(0, Math.ceil(-Math.log10(approximateTickStep) - 1e-10)),
      )
    : 2;
  const formatter = new Intl.NumberFormat("en-FI", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  return (value: number) => formatter.format(value);
}
