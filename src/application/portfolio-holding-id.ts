export function investmentHoldingId(input: {
  sourceAccountId: string;
  instrumentId: string;
}) {
  return `${input.sourceAccountId}:${input.instrumentId}`;
}

export function cashHoldingId(input: {
  sourceAccountId: string;
  currency: string;
}) {
  return `${input.sourceAccountId}:cash:${input.currency}`;
}
