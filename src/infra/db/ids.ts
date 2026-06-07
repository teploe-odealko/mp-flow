import { createHash } from "node:crypto";

export function stableUuid(value: string) {
  const normalized = `mpflow:${value}`;
  const hex = createHash("sha1").update(normalized).digest("hex");
  const part1 = hex.slice(0, 8);
  const part2 = hex.slice(8, 12);
  const part3 = `5${hex.slice(13, 16)}`;
  const part4 = `a${hex.slice(17, 20)}`;
  const part5 = hex.slice(20, 32);
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}
