export const importSourceKinds = [
  "screenshot",
  "trading-212",
  "manual",
  "demo",
  "csv",
] as const;

export type ImportSourceKind = (typeof importSourceKinds)[number];
