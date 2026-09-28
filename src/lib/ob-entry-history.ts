import type { EntryChange } from "./ob-entry-edit";

export type ObHistoryItem = { id: string; changedAt: string; actor: string; subject: string; details: string[] };
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" && v ? v : "未入力";
const events = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function historyProfileIds(changes: EntryChange[]): string[] {
  return [...new Set(changes.flatMap(c => [c.actor_id, object(c.before_data).profile_id, object(c.after_data).profile_id]).filter((id): id is string => typeof id === "string"))];
}

export function describeObChange(change: EntryChange, names: Map<string, string>): ObHistoryItem {
  const before = object(change.before_data), after = object(change.after_data);
  const details: string[] = [];
  if (after.change_type === "party") {
    if (before.status !== after.status) details.push(`懇親会：${before.status ? text(before.status) : "回答なし"} → ${text(after.status)}`);
    if (before.entry_id !== after.entry_id) details.push(after.entry_id ? "競技エントリーとの紐付けを設定" : "競技エントリーとの紐付けを解除");
  } else {
    if (!change.before_data) details.push("新規エントリー");
    const oldEvents = events(before.events), newEvents = events(after.events);
    const added = newEvents.filter(e => !oldEvents.includes(e)), removed = oldEvents.filter(e => !newEvents.includes(e));
    if (added.length) details.push(`種目追加：${added.join("、")}`);
    if (removed.length) details.push(`種目取消：${removed.join("、")}`);
    const oldMarks = object(before.qualification_marks), newMarks = object(after.qualification_marks);
    for (const event of newEvents) if (text(oldMarks[event]) !== text(newMarks[event])) details.push(`資格記録（${event}）：${text(oldMarks[event])} → ${text(newMarks[event])}`);
    if (before.profile_id !== after.profile_id && (before.profile_id || after.profile_id)) {
      const person = (id: unknown) => typeof id === "string" ? names.get(id) ?? "部員（名前取得不可）" : "未紐付け";
      details.push(`本人との紐付け：${person(before.profile_id)} → ${person(after.profile_id)}`);
    }
  }
  if (change.before_data) for (const [key, label] of [["submitted_name", "氏名"], ["grade", "学年"], ["competition_division", "出場区分"], ["group_label", "所属区分"], ["needs_review", "本人確認待ち"]]) {
    if (before[key] !== after[key]) details.push(`${label}：${typeof before[key] === "boolean" ? String(before[key]) : text(before[key])} → ${typeof after[key] === "boolean" ? String(after[key]) : text(after[key])}`);
  }
  return { id: change.id, changedAt: change.changed_at, actor: change.actor_id ? names.get(change.actor_id) ?? "操作ユーザー（名前取得不可）" : "操作ユーザー不明（取込・同期など）", subject: text(after.submitted_name), details: details.length ? details : ["登録情報を更新（種目・資格記録の変更なし）"] };
}
