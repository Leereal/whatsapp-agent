/** Compare dotted versions ("0.10.0" > "0.9.3"); pre-release suffixes are ignored */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) =>
    (value.split(/[-+]/)[0] ?? "").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function isOlderThan(current: string, minimum: string): boolean {
  return compareVersions(current, minimum) < 0;
}
