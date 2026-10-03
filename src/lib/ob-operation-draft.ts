import { emptyPerformance, type MeetEventData, type MeetPerformance } from "./meet-operations";

export type OperationField = "position" | "status" | "trials";
export type OperationConflict = { key: string; entryId: string; field: OperationField; own: MeetPerformance; current: MeetPerformance };
export type OperationChoices = Record<string, "own" | "current">;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const value = (p: MeetPerformance, field: OperationField) => field === "position" ? [p.group, p.order] : p[field];

/** Rebase only the changed fields. Choosing a position never replaces the person's results. */
export function reviewObOperation(base: MeetEventData, own: MeetEventData, current: MeetEventData, choices: OperationChoices = {}) {
  const before = new Map(base.participants.map(p => [p.entryId, p]));
  const draft = new Map(own.participants.map(p => [p.entryId, p]));
  const latest = new Map(current.participants.map(p => [p.entryId, p]));
  const conflicts: OperationConflict[] = [];
  const participants = [...new Set([...latest.keys(), ...draft.keys()])].map(id => {
    const a = before.get(id) ?? emptyPerformance(id), b = draft.get(id), c = latest.get(id);
    if (!b) return c!;
    if (!c) return b;
    const merged = { ...c };
    for (const field of ["position", "status", "trials"] as const) {
      const ownChanged = !same(value(a, field), value(b, field));
      const currentChanged = !same(value(a, field), value(c, field));
      const conflict = ownChanged && currentChanged && !same(value(b, field), value(c, field));
      const key = `${id}:${field}`;
      if (conflict) conflicts.push({ key, entryId: id, field, own: b, current: c });
      const chosen = ownChanged && (!conflict || choices[key] !== "current") ? b : c;
      if (field === "position") { merged.group = chosen.group; merged.order = chosen.order; }
      else if (field === "status") merged.status = chosen.status;
      else merged.trials = chosen.trials;
    }
    return merged;
  });
  // An approval made before these local changes cannot approve their unseen result.
  const confirmed = !own.confirmed && !same(participants, current.participants) ? false : own.confirmed === base.confirmed ? current.confirmed : own.confirmed;
  return { data: { participants, confirmed }, conflicts };
}

export function operationFieldLabel(p: MeetPerformance, field: OperationField) {
  if (field === "position") return p.group !== null && p.order !== null ? `${p.group}組 ${p.order}番` : "組未定";
  if (field === "status") return { entered: "出場", DNS: "DNS", DNF: "途中棄権", DQ: "失格" }[p.status];
  return p.trials.map((t, i) => `${i + 1}回目 ${t.mark || { pending: "未記録", valid: "記録あり", foul: "失敗", pass: "パス" }[t.status]}${t.wind ? ` (${t.wind})` : ""}`).join(" / ") || "未記録";
}
