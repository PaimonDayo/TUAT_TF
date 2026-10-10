import { MeetEvent, MeetMark, type MeetTrial } from "./meet-operations";
import { compareObEvents } from "./ob-entry-edit";
import type { ObEntry } from "./ob-entries";
import { OB_PROGRAM, obFamilyLabel } from "./ob-meet";
import { obFamilyRows, obMixedGroupLabel } from "./ob-mixed-operations";
import { obEventRule, type ObEventOperation } from "./ob-operations";
import type { XlsxCell, XlsxSheet } from "./xlsx-writer";
import { obResultRanks } from "./ob-result-ranking";

type Row = ReturnType<typeof obFamilyRows>[number];
const symbols: Record<MeetTrial["status"], string> = { valid: "○", foul: "×", pass: "−", pending: "" };

/** Events in program order, from registrations and saved operations alike. */
export function obResultFamilies(entries: ObEntry[], operations: ObEventOperation[]): string[] {
  const events = [...new Set([...entries.flatMap(entry => entry.events), ...operations.map(operation => operation.event_name)])].sort(compareObEvents);
  return [...new Set(events.map(event => event.replace(/^(男子|女子)/, "")))];
}

/** The timetable first, then one start list per event. Qualification marks are not exported. */
export function obResultSheets(entries: ObEntry[], operations: ObEventOperation[]): XlsxSheet[] {
  return [obProgramSheet(), ...obResultFamilies(entries, operations).map(family => obResultSheet(family, entries, operations))];
}

export function obProgramSheet(): XlsxSheet {
  return { name: "プログラム", widths: [8, 34, 14], rows: [["時刻", "内容", "備考"], ...OB_PROGRAM.map(slot => [slot.time, slot.label, slot.note ?? ""])] };
}

/** Fixed public workbook: attendance and withdrawals stay visible after later app edits. */
export function obPublishedResultSheets(entries: ObEntry[], operations: ObEventOperation[]): XlsxSheet[] {
  return [obProgramSheet(), ...OB_PROGRAM.flatMap(slot => slot.events).map(family => obResultSheet(family, entries, operations, true))];
}

/**
 * Start list sent to alumni: only people who compete or already have a result, without internal status columns.
 * Record columns appear once the event has a result, so a pre-meet sheet is just the start list.
 */
export function obResultSheet(family: string, entries: ObEntry[], operations: ObEventOperation[], published = false): XlsxSheet {
  const rule = obEventRule(family), rows = obFamilyRows(family, entries, operations).filter(row => published || row.state.canParticipate || row.state.recorded);
  const recorded = rows.some(row => row.state.recorded);
  const results = published || recorded;
  const personHeaders = ["区分", "氏名", "学年", ...(published ? ["出場状況"] : [])];
  const personWidths = [6, 18, 7, ...(published ? [18] : [])];
  const person = (row: Row): XlsxCell[] => [row.division, row.entry?.submitted_name ?? "参加情報なし", row.entry?.grade ?? "",
    ...(published ? [publishedParticipation(row)] : [])];
  const best = (row: Row) => row.state.recorded ? new MeetEvent(obEventRule(row.eventName), { participants: [row.performance], confirmed: false }).best(row.performance) : "";
  const name = obFamilyLabel(family);
  const ranks = new Map(["男子", "女子"].flatMap(division => [...obResultRanks(rule,
    rows.filter(row => row.division === division && row.state.canParticipate).map(row => row.performance))]));
  const ranked = (sheet: XlsxSheet): XlsxSheet => {
    if (!results) return sheet;
    let personIndex = 0;
    return { ...sheet, widths: [...sheet.widths!, 7], rows: sheet.rows.map((line, index) =>
      !index ? [...line, "順位"] : !line.length ? line : [...line, ranks.get(rows[personIndex++].performance.entryId) ?? ""]) };
  };

  if (rule.discipline === "track") {
    const lanes = !["1500m", "3000m"].includes(family);
    const windOf = (row: Row) => { const trial = row.performance.trials[0]; return row.performance.status === "entered" && trial?.status === "valid" ? trial.wind : ""; };
    const result = (row: Row): XlsxCell[] => results ? [best(row), ...(rule.wind ? [windOf(row)] : [])] : [];
    const lines: XlsxCell[][] = [["組", ...(lanes ? ["レーン"] : []), ...personHeaders, ...(results ? ["記録", ...(rule.wind ? ["風速"] : [])] : [])]];
    let heat: string | undefined;
    for (const row of rows) {
      const label = row.group === null ? "組未定" : obMixedGroupLabel(row.group);
      // The heat is named once on its first line; a blank line separates heats.
      if (heat !== undefined && label !== heat) lines.push([]);
      lines.push([label === heat ? null : label, ...(lanes ? [row.group === null ? null : row.performance.order] : []), ...person(row), ...result(row)]);
      heat = label;
    }
    return ranked({ name, widths: [10, ...(lanes ? [7] : []), ...personWidths, ...(results ? [10, ...(rule.wind ? [7] : [])] : [])], rows: lines });
  }

  const order = (row: Row): XlsxCell => row.number ?? "順番未定";
  if (rule.discipline === "height") {
    const heights = heightColumns(rows);
    return ranked({ name, widths: [8, ...personWidths, ...(results ? [10, ...heights.map(() => 7)] : [])], rows: [
      ["試技順", ...personHeaders, ...(results ? ["記録", ...heights.map(height => height.label)] : [])],
      ...rows.map(row => [order(row), ...person(row), ...(results ? [best(row), ...heights.map(height => row.performance.trials.filter(trial => heightKey(trial) === height.key).map(trial => symbols[trial.status]).join(""))] : [])]),
    ] });
  }

  const count = Math.max(6, ...rows.map(row => row.performance.trials.length));
  const attempts = recorded ? Array.from({ length: count }, (_, i) => i) : [];
  const bestWind = (row: Row) => row.performance.status === "entered" ? new MeetEvent(obEventRule(row.eventName), { participants: [], confirmed: false }).bestTrial(row.performance)?.wind ?? "" : "";
  const trialText = (trial: MeetTrial | undefined) => !trial ? "" : trial.status === "valid" || trial.status === "pending" ? trial.mark : symbols[trial.status];
  return ranked({ name, widths: [8, ...personWidths, ...(results ? [10, ...(rule.wind ? [8] : [])] : []), ...attempts.flatMap(() => rule.wind ? [8, 7] : [8])], rows: [
    ["試技順", ...personHeaders, ...(results ? ["記録", ...(rule.wind ? ["記録の風速"] : [])] : []), ...attempts.flatMap(i => rule.wind ? [`${i + 1}回目`, `${i + 1}回目風速`] : [`${i + 1}回目`])],
    ...rows.map(row => [order(row), ...person(row), ...(results ? [best(row), ...(rule.wind ? [bestWind(row)] : [])] : []),
      ...attempts.flatMap(i => { const trial = row.performance.trials[i]; return rule.wind ? [trialText(trial), trial?.status === "valid" ? trial.wind : ""] : [trialText(trial)]; })]),
  ] });
}

/** Meet attendance is separate from the event declaration; saved marks never disappear. */
function publishedParticipation(row: Row): string {
  if (!row.entry) return "参加情報なし";
  if (!row.state.registered) return "DNS（欠場）";
  if (row.performance.status === "DNS") return "DNS（欠場）";
  if (row.performance.status === "DNF") return "DNF（途中棄権）";
  if (row.performance.status === "DQ") return "DQ（失格）";
  if (row.entry.absent && !row.state.recorded) return "DNS（欠場）";
  return "出場";
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
