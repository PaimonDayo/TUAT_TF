import { MeetEvent, MeetMark, type MeetTrial } from "./meet-operations";
import { compareObEvents } from "./ob-entry-edit";
import type { ObEntry } from "./ob-entries";
import { obFamilyLabel } from "./ob-meet";
import { obFamilyRows, obMixedGroupLabel } from "./ob-mixed-operations";
import { obEventRule, type ObEventOperation } from "./ob-operations";
import type { XlsxCell, XlsxSheet } from "./xlsx-writer";

type Row = ReturnType<typeof obFamilyRows>[number];
const symbols: Record<MeetTrial["status"], string> = { valid: "○", foul: "×", pass: "−", pending: "" };

/** Events in program order, from registrations and saved operations alike. */
export function obResultFamilies(entries: ObEntry[], operations: ObEventOperation[]): string[] {
  const events = [...new Set([...entries.flatMap(entry => entry.events), ...operations.map(operation => operation.event_name)])].sort(compareObEvents);
  return [...new Set(events.map(event => event.replace(/^(男子|女子)/, "")))];
}

/** One sheet per event with heats/trial order and recorded results. Qualification marks are not exported. */
export function obResultSheets(entries: ObEntry[], operations: ObEventOperation[]): XlsxSheet[] {
  return obResultFamilies(entries, operations).map(family => obResultSheet(family, entries, operations));
}

export function obResultSheet(family: string, entries: ObEntry[], operations: ObEventOperation[]): XlsxSheet {
  const rule = obEventRule(family), rows = obFamilyRows(family, entries, operations);
  const person = (row: Row): XlsxCell[] => [row.division, row.entry?.submitted_name ?? "参加情報なし", row.entry?.grade ?? "", row.state.status === "entered" ? "出場" : row.state.label];
  const best = (row: Row) => row.state.recorded ? new MeetEvent(obEventRule(row.eventName), { participants: [row.performance], confirmed: false }).best(row.performance) : "";
  const tail = (row: Row): XlsxCell[] => [row.saved?.data.confirmed ? "確認済み" : "速報", row.state.recorded && row.state.absent ? "以降は欠席" : row.state.recorded && !row.state.registered ? "登録取消・記録保持" : ""];
  const tailHeader = ["確認状況", "備考"], tailWidths = [10, 18];
  const name = obFamilyLabel(family);

  if (rule.discipline === "track") {
    const windOf = (row: Row) => { const trial = row.performance.trials[0]; return row.performance.status === "entered" && trial?.status === "valid" ? trial.wind : ""; };
    return { name, widths: [10, 7, 6, 18, 7, 12, 10, ...(rule.wind ? [7] : []), ...tailWidths], rows: [
      ["組", ["1500m", "3000m"].includes(family) ? "番号" : "レーン", "区分", "氏名", "学年", "出場状況", "記録", ...(rule.wind ? ["風速"] : []), ...tailHeader],
      ...rows.map(row => [row.group === null ? "組未定" : obMixedGroupLabel(row.group), row.performance.order, ...person(row), best(row), ...(rule.wind ? [windOf(row)] : []), ...tail(row)]),
    ] };
  }

  const order = (row: Row): XlsxCell => row.number ?? "順番未定";
  if (rule.discipline === "height") {
    const heights = heightColumns(rows);
    return { name, widths: [8, 6, 18, 7, 12, 10, ...heights.map(() => 7), ...tailWidths], rows: [
      ["試技順", "区分", "氏名", "学年", "出場状況", "記録", ...heights.map(height => height.label), ...tailHeader],
      ...rows.map(row => [order(row), ...person(row), best(row), ...heights.map(height => row.performance.trials.filter(trial => heightKey(trial) === height.key).map(trial => symbols[trial.status]).join("")), ...tail(row)]),
    ] };
  }

  const count = Math.max(6, ...rows.map(row => row.performance.trials.length));
  const attempts = Array.from({ length: count }, (_, i) => i);
  const bestWind = (row: Row) => row.performance.status === "entered" ? new MeetEvent(obEventRule(row.eventName), { participants: [], confirmed: false }).bestTrial(row.performance)?.wind ?? "" : "";
  const trialText = (trial: MeetTrial | undefined) => !trial ? "" : trial.status === "valid" || trial.status === "pending" ? trial.mark : symbols[trial.status];
  return { name, widths: [8, 6, 18, 7, 12, 10, ...(rule.wind ? [8] : []), ...attempts.flatMap(() => rule.wind ? [8, 7] : [8]), ...tailWidths], rows: [
    ["試技順", "区分", "氏名", "学年", "出場状況", "記録", ...(rule.wind ? ["記録の風速"] : []), ...attempts.flatMap(i => rule.wind ? [`${i + 1}回目`, `${i + 1}回目風速`] : [`${i + 1}回目`]), ...tailHeader],
    ...rows.map(row => [order(row), ...person(row), best(row), ...(rule.wind ? [bestWind(row)] : []),
      ...attempts.flatMap(i => { const trial = row.performance.trials[i]; return rule.wind ? [trialText(trial), trial?.status === "valid" ? trial.wind : ""] : [trialText(trial)]; }), ...tail(row)]),
  ] };
}

/** High jump attempts are grouped under each bar height; unreadable heights stay as typed. */
function heightKey(trial: MeetTrial): string | null {
  if (trial.status === "pending" || !trial.mark) return null;
  const value = MeetMark.parse(trial.mark, "height");
  return value === null ? `raw:${trial.mark}` : `cm:${value}`;
}
function heightColumns(rows: Row[]) {
  const keys = new Map<string, { key: string; label: string; value: number }>();
  for (const trial of rows.flatMap(row => row.performance.trials)) {
    const key = heightKey(trial);
    if (key === null || keys.has(key)) continue;
    const value = key.startsWith("cm:") ? Number(key.slice(3)) : Number.POSITIVE_INFINITY;
    keys.set(key, { key, value, label: Number.isFinite(value) ? (value / 100).toFixed(2) : trial.mark });
  }
  return [...keys.values()].sort((a, b) => a.value - b.value);
}

/** JST timestamp keeps successive exports on the meet day apart. */
export function obResultsFileName(now: Date): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map(part => [part.type, part.value]));
  return `OB戦_組・記録_${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}.xlsx`;
}
