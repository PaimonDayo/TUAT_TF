/** Format shorthand on leaving a cell, so partially typed digits stay untouched. */
export function formatObRecordInput(text: string, family: string): string {
  const value = text.normalize("NFKC").trim();
  if (!/^\d{3,7}$/.test(value)) return value;
  if (["1500m", "3000m"].includes(family) && value.length >= 5) {
    return `${Number(value.slice(0, -4))}:${value.slice(-4, -2)}.${value.slice(-2)}`;
  }
  return `${Number(value.slice(0, -2))}.${value.slice(-2)}`;
}
