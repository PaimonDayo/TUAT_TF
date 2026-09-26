import { isAlumniEntry, type ObEntry } from "./ob-entries";
import { entryGrade, type EntryMember } from "./entry-identity";

/**
 * OB戦は大会一覧の「OB戦」と同じ大会として扱う。プログラム画面は
 * /competitions/{competitionId}/program に置き、27大戦などと同じ入口にそろえる。
 */
export const OB_MEET = { competitionId: "3e2a2b1e-21d1-49b0-a1e8-40bf595fb7e5", meetKey: "ob-2026" } as const;
export const OB_PROGRAM_PATH = `/competitions/${OB_MEET.competitionId}/program`;
export function isObCompetition(competitionId: string): boolean {
  return competitionId === OB_MEET.competitionId;
}

export const OB_PARTY = { time: "19:00〜", venue: "ミライザカ 府中並木通り店", fee: 3500 };
export const PARTY_STATUSES = ["参加", "不参加", "未回答"] as const;
export type PartyStatus = typeof PARTY_STATUSES[number];
export type ObPartyResponse = { id: string; meet_key: string; submitted_name: string; group_label: string; status: PartyStatus; entry_id: string | null; revision: number; needs_review: boolean };
export type PartyEdit = { id: string | null; revision: number | null; status: PartyStatus };
export function validPartyEdit(value: PartyEdit): boolean {
  return !!value && PARTY_STATUSES.includes(value.status) && (value.id === null ? value.revision === null :
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id) && Number.isSafeInteger(value.revision) && value.revision! >= 0);
}
export const OB_PROGRAM: { time: string; label: string; events: string[]; note?: string }[] = [
  { time: "09:00", label: "受付開始", events: [] },
  { time: "09:30", label: "開会式", events: [] },
  { time: "10:00", label: "1500m", events: ["1500m"] },
  { time: "10:30", label: "ジャベリックスロー・立ち五段跳び", events: ["ジャベリックスロー", "立ち五段"] },
  { time: "11:00", label: "100m・砲丸投げ", events: ["100m", "砲丸投げ"] },
  { time: "11:40", label: "300mH", events: ["300mH"] },
  { time: "12:20", label: "OB・OG総会", events: [] },
  { time: "13:00", label: "走り高跳び", events: ["走り高跳び"] },
  { time: "13:30", label: "300m", events: ["300m"] },
  { time: "14:30", label: "やり投げ・走り幅跳び", events: ["やり投げ", "走り幅跳び"] },
  { time: "15:00", label: "3000m", events: ["3000m"] },
  { time: "15:30", label: "4×300mリレー", events: [], note: "当日エントリー" },
  { time: "16:00", label: "閉会式", events: [] },
];
export const OB_DUTY_SLOTS = OB_PROGRAM.filter((slot) => slot.events.length || slot.note).flatMap((slot) =>
  slot.events.length ? slot.events.map((event) => ({ ...slot, label: event === "立ち五段" ? "立ち五段跳び" : event, events: [event] })) : [slot]);
/** Include concurrent competitions even when the helper assignment belongs to another event. */
export function dutyTimeCell(entry: Pick<ObEntry, "events"> | undefined, slot: typeof OB_PROGRAM[number]): string {
  return dutyCell(entry, OB_PROGRAM.find((s) => s.time === slot.time) ?? slot);
}

/** No finish times or warm-up durations have been provided: absence of an entry is not availability. */
export function dutyCell(entry: Pick<ObEntry, "events"> | undefined, slot: typeof OB_PROGRAM[number]): string {
  if (slot.note) return "当日確認";
  if (!entry) return "エントリー未確認";
  const events = entry.events.filter((event) => slot.events.includes(event.slice(2))).map((event) => event.slice(2));
  return events.length ? events.join("・") : "出場登録なし";
}
/** 学年の並び順（B1→B4→M1→M2→D1→D3、OB・OG・不明は後ろ）。 */
const GRADE_ORDER = ["B1", "B2", "B3", "B4", "M1", "M2", "D1", "D2", "D3"];
export function obGradeRank(grade: string | null): number {
  const i = GRADE_ORDER.indexOf(entryGrade(grade));
  return i >= 0 ? i : GRADE_ORDER.length + (grade === "OB・OG" ? 1 : 0);
}
/** 学年順（B1から）→氏名順 */
export function compareByGrade(a: { grade: string | null; name: string }, b: { grade: string | null; name: string }): number {
  return obGradeRank(a.grade) - obGradeRank(b.grade) || (a.grade ?? "").localeCompare(b.grade ?? "", "ja") || a.name.localeCompare(b.name, "ja");
}
/** その時間帯に出場するか（リレーの当日確認・出場登録なし・未確認は出場しない扱い） */
export function isCompeting(cell: string): boolean {
  return cell !== "出場登録なし" && cell !== "エントリー未確認" && cell !== "当日確認";
}
export function dutyRows(entries: ObEntry[], members: EntryMember[]) {
  entries = entries.filter((entry) => !isAlumniEntry(entry));
  return [
    ...members.filter((m) => entries.some((e) => e.profile_id === m.id)).map((m) => ({ id: m.id, name: m.display_name, grade: entryGrade(m.grade), entry: entries.find((e) => e.profile_id === m.id), linked: true })),
    ...entries.filter((e) => !e.profile_id || !members.some((m) => m.id === e.profile_id)).map((e) => ({ id: e.id, name: e.submitted_name, grade: e.grade, entry: e, linked: false })),
  ].sort(compareByGrade);
}
export function partyCounts(responses: ObPartyResponse[]) {
  return { attending: responses.filter((p) => !p.needs_review && p.status === "参加").length,
    absent: responses.filter((p) => !p.needs_review && p.status === "不参加").length,
    unknown: responses.filter((p) => !p.needs_review && p.status === "未回答").length,
    held: responses.filter((p) => p.needs_review).length };
}
export function obCsvCell(value: string): string {
  // Neutralise spreadsheet formula injection in user-authored names and marks.
  const safe = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
