const alphabet =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function rankBetween(before?: string | null, after?: string | null) {
  if (!before && !after) return "U";
  if (!before) return `0${after}`;
  if (!after) return `${before}U`;
  let prefix = "";
  const length = Math.max(before.length, after.length) + 1;
  for (let index = 0; index < length; index += 1) {
    const left = index < before.length ? alphabet.indexOf(before[index]) : 0;
    const right =
      index < after.length
        ? alphabet.indexOf(after[index])
        : alphabet.length - 1;
    if (right - left > 1)
      return `${prefix}${alphabet[Math.floor((left + right) / 2)]}`;
    prefix += alphabet[Math.max(left, 0)];
  }
  return `${before}U`;
}

export function rebalanceRanks(count: number) {
  return Array.from(
    { length: count },
    (_, index) => `r${String(index + 1).padStart(6, "0")}`,
  );
}
