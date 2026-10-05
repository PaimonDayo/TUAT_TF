import type { EntryChange } from "./ob-entry-edit";

export type ObHistoryDetail = { label: string; before: string | null; after: string | null; subject?: string };
export type ObHistoryItem = { id: string; changedAt: string; actor: string; subject: string; categories: string[]; details: ObHistoryDetail[] };
export type ObOperationChange = EntryChange & { meet_key: string; event_name: string };
/** PostgreSQL timestamps retain microseconds; millisecond-only sorting can skip tied page rows. */
export function compareObHistoryPosition(a: Pick<EntryChange, "id" | "changed_at">, b: Pick<EntryChange, "id" | "changed_at">): number {
  const micros = (at: string) => BigInt(Date.parse(at)) * BigInt(1000) + BigInt((at.match(/\.(\d+)/)?.[1] ?? "").padEnd(6, "0").slice(3, 6));
  const left = micros(a.changed_at), right = micros(b.changed_at);
  return left === right ? a.id === b.id ? 0 : a.id > b.id ? -1 : 1 : left > right ? -1 : 1;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, fallback = "未入力") => typeof value === "string" && value ? value : fallback;
const events = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const actor = (change: EntryChange, names: Map<string, string>) => change.actor_id ? names.get(change.actor_id) ?? "名前を取得できない操作ユーザー" : "不明（取込・同期など）";

export function historyProfileIds(changes: EntryChange[]): string[] {
  return [...new Set(changes.flatMap(change => [change.actor_id, object(change.before_data).profile_id, object(change.after_data).profile_id]).filter((id): id is string => typeof id === "string"))];
}

function participants(value: unknown): Record<string, unknown>[] {
  const rows = object(value).participants;
  return Array.isArray(rows) ? rows.map(object).filter(row => typeof row.entryId === "string") : [];
}

export function historyEntryIds(changes: ObOperationChange[]): string[] {
  return [...new Set(changes.flatMap(change => [...participants(change.before_data), ...participants(change.after_data)].map(row => row.entryId as string)))];
}

/** Only display fields leave the server; snapshots, request payloads and internal IDs stay there. */
export function describeObChange(change: EntryChange, names: Map<string, string>): ObHistoryItem {
  const before = object(change.before_data), after = object(change.after_data);
  const details: ObHistoryDetail[] = [], categories = new Set<string>();
  const add = (category: string, label: string, previous: string | null, next: string | null) => {
    categories.add(category); details.push({ label, before: previous, after: next });
  };
  if (after.change_type === "entry_deleted") {
    add("削除", "エントリー", "登録あり", "削除（懇親会の回答は保持）");
  } else if (after.change_type === "party") {
    if (before.status !== after.status) add("懇親会", "懇親会の出欠", text(before.status, "回答なし"), text(after.status));
    if (before.entry_id !== after.entry_id) add("懇親会", "競技エントリーとの紐付け", before.entry_id ? "紐付けあり" : "紐付けなし", after.entry_id ? "紐付けあり" : "紐付けなし");
  } else {
    if (!change.before_data) add("新規登録", "エントリー", "登録なし", "登録");
    const oldEvents = events(before.events), newEvents = events(after.events);
    const added = newEvents.filter(event => !oldEvents.includes(event)), removed = oldEvents.filter(event => !newEvents.includes(event));
    if (added.length) add("出場種目", "種目追加", "未登録", added.join("、"));
    if (removed.length) add("出場種目", "種目取消", removed.join("、"), "取消");
    const oldMarks = object(before.qualification_marks), newMarks = object(after.qualification_marks);
    for (const event of new Set([...oldEvents, ...newEvents])) {
      if (text(oldMarks[event]) !== text(newMarks[event])) add("資格記録", `資格記録（${event}）`, text(oldMarks[event]), text(newMarks[event]));
    }
    if (before.profile_id !== after.profile_id && (before.profile_id || after.profile_id)) {
      const person = (id: unknown) => typeof id === "string" ? names.get(id) ?? "名前を取得できない部員" : "未紐付け";
      add("本人照合", "本人との紐付け", person(before.profile_id), person(after.profile_id));
    }
    if ((before.absent === true) !== (after.absent === true)) add("大会欠席", "大会への参加", before.absent === true ? "欠席" : "参加", after.absent === true ? "欠席" : "参加");
  }
  if (change.before_data && after.change_type !== "entry_deleted") {
    for (const [key, label] of [["submitted_name", "氏名"], ["grade", "学年"], ["competition_division", "出場区分"], ["group_label", "所属区分"]]) {
      if (before[key] !== after[key]) add("登録情報", label, text(before[key]), text(after[key]));
    }
    if (before.needs_review !== after.needs_review) {
      const review = (value: unknown) => value === true ? "確認待ち" : value === false ? "確認済み" : "未登録";
      add("本人照合", "本人確認", review(before.needs_review), review(after.needs_review));
    }
  }
  if (!details.length) add(after.change_type === "party" ? "懇親会" : "登録情報", "登録情報", null, "更新（表示項目の変更なし）");
  return { id: `entry:${change.id}`, changedAt: change.changed_at, actor: actor(change, names), subject: text(after.submitted_name, text(before.submitted_name, "名前の記録なし")), categories: [...categories], details };
}

/** Diff competition state by entry ID, so roster reordering is not mistaken for a person's edit. */
export function describeObOperationChange(change: ObOperationChange, names: Map<string, string>, entryNames: Map<string, string>): ObHistoryItem {
  const before = object(change.before_data), after = object(change.after_data);
  const oldPeople = new Map(participants(before).map(person => [person.entryId as string, person]));
  const newPeople = new Map(participants(after).map(person => [person.entryId as string, person]));
  const details: ObHistoryDetail[] = [], categories = new Set<string>();
  const add = (category: string, label: string, previous: string | null, next: string | null, subject?: string) => {
    categories.add(category); details.push({ label, before: previous, after: next, ...(subject ? { subject } : {}) });
  };
  const placement = (value: unknown) => typeof value === "number" ? String(value) : "未割当";
  const status = (value: unknown) => ({ entered: "出場", DNS: "DNS（欠場）", DNF: "DNF（途中棄権）", DQ: "DQ（失格）" }[String(value)] ?? "未登録");
  const trialStatus = (value: unknown) => ({ pending: "未記録", valid: "成功", foul: "失敗", pass: "パス" }[String(value)] ?? "試技なし");
  const isTrack = /^(男子|女子)(100m|300m|300mH|1500m|3000m)$/.test(change.event_name);
  const orderLabel = /^(男子|女子)(100m|300m|300mH)$/.test(change.event_name) ? "レーン" : isTrack ? "番号" : "試技順";
  for (const entryId of new Set([...oldPeople.keys(), ...newPeople.keys()])) {
    const previous = oldPeople.get(entryId), next = newPeople.get(entryId);
    const subject = entryNames.get(entryId) ?? "名前を取得できない出場者";
    if (!previous || !next) add("出場者", "出場者", previous ? "登録あり" : "登録なし", next ? "追加" : "削除", subject);
    for (const [key, label] of [["group", "組"], ["order", orderLabel]]) {
      if (placement(previous?.[key]) !== placement(next?.[key])) add("組・順番", label, placement(previous?.[key]), placement(next?.[key]), subject);
    }
    if (status(previous?.status) !== status(next?.status)) add("出場状況", "出場状況", status(previous?.status), status(next?.status), subject);
    const oldTrials = Array.isArray(previous?.trials) ? previous.trials.map(object) : [];
    const newTrials = Array.isArray(next?.trials) ? next.trials.map(object) : [];
    for (let index = 0; index < Math.max(oldTrials.length, newTrials.length); index++) {
      const oldTrial = oldTrials[index], newTrial = newTrials[index];
      const label = isTrack ? "記録" : `${index + 1}回目`;
      if (text(oldTrial?.mark) !== text(newTrial?.mark)) add("記録・試技", isTrack ? "タイム" : `${label}の記録`, text(oldTrial?.mark), text(newTrial?.mark), subject);
      if (trialStatus(oldTrial?.status) !== trialStatus(newTrial?.status)) add("記録・試技", `${label}の結果`, trialStatus(oldTrial?.status), trialStatus(newTrial?.status), subject);
      if (text(oldTrial?.wind) !== text(newTrial?.wind)) add("記録・試技", `${label}の風速`, text(oldTrial?.wind), text(newTrial?.wind), subject);
    }
  }
  if (!change.before_data || (before.confirmed === true) !== (after.confirmed === true)) {
    add("確定", "記録の確定", change.before_data ? before.confirmed === true ? "確定" : "速報" : "保存なし", after.confirmed === true ? "確定" : "速報");
  }
  if (!details.length) add("競技・記録", "競技情報", null, "保存（表示項目の変更なし）");
  return { id: `operation:${change.id}`, changedAt: change.changed_at, actor: actor(change, names), subject: change.event_name, categories: [...categories], details };
}
