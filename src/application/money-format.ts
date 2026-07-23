const originalMoneyNumber = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatOriginalMoney(value: number, currency: string) {
  return `${originalMoneyNumber.format(value)} ${currency}`;
}

export function formatSignedOriginalMoney(value: number, currency: string) {
  return `${value >= 0 ? "+" : "−"}${formatOriginalMoney(
    Math.abs(value),
    currency,
  )}`;
}
