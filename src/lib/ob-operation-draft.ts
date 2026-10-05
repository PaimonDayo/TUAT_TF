import { emptyPerformance, type MeetEventData, type MeetPerformance } from "./meet-operations";

export type OperationField = "position" | "status" | "trials";
export type OperationConflict = { key: string; entryId: string; field: OperationField; own: MeetPerformance; current: MeetPerformance };
export type OperationChoices = Record<string, "own" | "current">;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const value = (p: MeetPerformance, field: OperationField) => field === "position" ? [p.group, p.order] : p[field];

const sameTrials = (a: MeetPerformance, b: MeetPerformance) => a.trials.length === b.trials.length
  && a.trials.every((trial, i) => trial.mark === b.trials[i].mark && trial.status === b.trials[i].status && trial.wind === b.trials[i].wind);

/** Empty trailing input slots are display scaffolding; recorded trial positions remain significant. */
function meaningfulTrialCount(person: MeetPerformance): number {
  let count = person.trials.length;
  while (count > 0) {
    const trial = person.trials[count - 1];
    if (trial.status !== "pending" || trial.mark !== "" || trial.wind !== "") break;
    count--;
  }
  return count;
}

/** Compare displayed content, preserving the exact server snapshot for save/conflict checks. */
export function obOperationHasChanges(base: MeetEventData, current: MeetEventData): boolean {
  if (base.confirmed !== current.confirmed || base.participants.length !== current.participants.length) return true;
  const before = new Map(base.participants.map(person => [person.entryId, person]));
  if (before.size !== base.participants.length || new Set(current.participants.map(person => person.entryId)).size !== current.participants.length) return true;
  return current.participants.some(person => {
    const original = before.get(person.entryId);
    if (!original || original.group !== person.group || original.order !== person.order || original.status !== person.status) return true;
    const count = meaningfulTrialCount(person);
    return meaningfulTrialCount(original) !== count || person.trials.slice(0, count).some((trial, index) => {
      const previous = original.trials[index];
      return trial.mark !== previous.mark || trial.status !== previous.status || trial.wind !== previous.wind;
    });
  });
}

/** Confirm only submitted changes, retaining other people's edits and newly added participants. */
export function obOperationSaveMatches(base: MeetEventData, own: MeetEventData, current: MeetEventData): boolean {
  if (own.confirmed !== base.confirmed && current.confirmed !== own.confirmed) return false;
  const before = new Map(base.participants.map(person => [person.entryId, person]));
  const submitted = new Map(own.participants.map(person => [person.entryId, person]));
  const saved = new Map(current.participants.map(person => [person.entryId, person]));
  // Removing participants is not an accepted operation; a read must not silently approve one.
  if (base.participants.some(person => !submitted.has(person.entryId))) return false;
  return own.participants.every(person => {
    const original = before.get(person.entryId), latest = saved.get(person.entryId);
    if (!latest) return false;
    if ((!original || original.group !== person.group || original.order !== person.order)
      && (latest.group !== person.group || latest.order !== person.order)) return false;
    if ((!original || original.status !== person.status) && latest.status !== person.status) return false;
    if ((!original || !sameTrials(original, person)) && !sameTrials(latest, person)) return false;
    return true;
  });
}

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
