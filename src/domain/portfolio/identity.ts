export function normalizedIdentityKeys(
  values: readonly (string | undefined)[],
): string[] {
  return values
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim().toUpperCase());
}

export function identitiesOverlap(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftKeys = new Set(left);
  return right.some((key) => leftKeys.has(key));
}
