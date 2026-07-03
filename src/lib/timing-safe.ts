import { timingSafeEqual } from "node:crypto";

/** タイミング攻撃を避ける文字列比較（Bearerトークン等）。長さが違う場合は先にfalse。 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
