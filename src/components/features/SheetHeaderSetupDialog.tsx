"use client";

import { useMemo, useState } from "react";
import { Check, Eye, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import {
  buildSheetRecordFields,
  defaultSelectedSheetColumns,
  inferSheetFieldType,
  isFixedSheetColumn,
  isIgnoredSheetColumn,
  relevantSheetHeaderSignature,
  sheetBuiltinKey,
  timelineFieldLimit,
  type SheetHeaderColumn,
} from "@/lib/sheet-field-config";
import type { RecordFieldDef } from "@/types";

export type SheetHeaderData = {
  sheetName: string;
  columns: SheetHeaderColumn[];
  signature: string;
  memoCandidates: number[];
};

export function SheetHeaderSetupDialog({
  open,
  data,
  initialFields = [],
  isMiddleLong,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  data: SheetHeaderData;
  initialFields?: RecordFieldDef[];
  isMiddleLong: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (fields: RecordFieldDef[], signature: string) => void;
}) {
  const fixed = useMemo(
    () => data.columns.filter((column) => !isIgnoredSheetColumn(column.label) && isFixedSheetColumn(column.label, isMiddleLong) && sheetBuiltinKey(column.label, { isMiddleLong }, column.index) !== "dist_actual"),
    [data, isMiddleLong],
  );
  const selectable = useMemo(
    () => data.columns.filter((column) => !isIgnoredSheetColumn(column.label) && !isFixedSheetColumn(column.label, isMiddleLong)),
    [data, isMiddleLong],
  );
  const memoColumn = data.memoCandidates[0] ?? null;
  const existingByColumn = useMemo(
    () => new Map(initialFields.filter((field) => field.sourceColumn !== undefined).map((field) => [field.sourceColumn!, field])),
    [initialFields],
  );
  const hasExplicitSheetConfig = initialFields.some((field) =>
    field.sourceColumn !== undefined && typeof field.showInTimeline === "boolean",
  );
  const defaults = useMemo(
    () => defaultSelectedSheetColumns(data.columns, isMiddleLong, memoColumn),
    [data, isMiddleLong, memoColumn],
  );
  const [selected, setSelected] = useState<number[]>(() => hasExplicitSheetConfig
    ? selectable.filter((column) => existingByColumn.has(column.index) && !existingByColumn.get(column.index)?.hidden).map((column) => column.index)
    : defaults);
  const [timelineSelected, setTimelineSelected] = useState<number[]>(() => hasExplicitSheetConfig
    ? selectable.filter((column) => existingByColumn.get(column.index)?.showInTimeline === true).map((column) => column.index)
    : defaults);
  const [types, setTypes] = useState<Record<number, "text" | "number">>(() => Object.fromEntries(
    selectable.map((column) => [column.index, existingByColumn.get(column.index)?.type ?? inferSheetFieldType(column.label)]),
  ));
  const [message, setMessage] = useState<string | null>(null);
  const limit = timelineFieldLimit(isMiddleLong);

  function toggleInput(column: number) {
    setMessage(null);
    setSelected((current) => {
      if (current.includes(column)) {
        setTimelineSelected((timeline) => timeline.filter((value) => value !== column));
        return current.filter((value) => value !== column);
      }
      return [...current, column];
    });
  }

  function toggleTimeline(column: number) {
    setMessage(null);
    setTimelineSelected((current) => {
      if (current.includes(column)) return current.filter((value) => value !== column);
      if (current.length >= limit) {
        setMessage(`表示できる追加項目は最大${limit}個です。先に1つ外してください`);
        return current;
      }
      return [...current, column];
    });
  }

  function confirm() {
    const fields = buildSheetRecordFields({
      columns: data.columns,
      selectedColumns: selected,
      timelineColumns: timelineSelected,
      types,
      isMiddleLong,
      memoColumn,
    });
    onConfirm(fields, relevantSheetHeaderSignature(data.columns, fields, isMiddleLong));
  }

  return (
    <FormModal open={open} onOpenChange={(next) => !next && onCancel()} title="練習記録フォーム・タイムライン表示" autoFocus={false}>
      <div className="space-y-4 pb-5">
        <div className="rounded-xl bg-accent/8 px-3 py-2.5 text-caption leading-relaxed">
          「{data.sheetName}」の見出しから作成します。日付・曜日は自動で判別し、スプレッドシートにない項目は表示しません。
        </div>

        {isMiddleLong && fixed.length > 0 && <section className="rounded-2xl border border-separator bg-card p-3">
          <div className="mb-2 flex items-center gap-2"><Check size={17} className="text-accent" /><h3 className="text-[14px] font-semibold">標準項目</h3></div>
          <p className="mb-2 text-micro text-muted2">入力フォームとタイムラインに設定済みです</p>
          <div className="flex flex-wrap gap-2">{fixed.map((column) => <span key={column.index} className="rounded-full bg-accent/10 px-2.5 py-1 text-micro font-semibold text-accent">{column.label}</span>)}</div>
        </section>}

        <section>
          <div className="mb-2 flex items-center gap-2"><ListChecks size={17} className="text-accent" /><h3 className="text-[14px] font-semibold">入力フォームに追加する項目</h3></div>
          <div className="space-y-2">
            {selectable.map((column) => {
              const checked = selected.includes(column.index);
              return <div key={column.index} className={`rounded-2xl border p-3 ${checked ? "border-accent/40 bg-accent/5" : "border-separator bg-card"}`}>
                <button type="button" onClick={() => toggleInput(column.index)} className="flex min-h-8 w-full items-center gap-2 text-left">
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? "border-accent bg-accent text-white" : "border-separator bg-card"}`}>{checked && <Check size={14} strokeWidth={3} />}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{column.label}</span>
                </button>
                {checked && <div className="mt-3 border-t border-separator/70 pt-3">
                  <div className="grid grid-cols-2 gap-2">{(["text", "number"] as const).map((type) => <button key={type} type="button" onClick={() => setTypes((current) => ({ ...current, [column.index]: type }))} className={`h-9 rounded-lg border text-caption font-semibold ${types[column.index] === type ? "border-accent bg-accent/10 text-accent" : "border-separator bg-card text-muted2"}`}>{type === "text" ? "文字列" : "数値"}</button>)}</div>
                </div>}
              </div>;
            })}
            {selectable.length === 0 && <p className="rounded-xl border border-dashed border-separator p-4 text-center text-caption text-muted">追加できる列はありません</p>}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><Eye size={17} className="text-accent" /><h3 className="text-[14px] font-semibold">タイムラインへ表示する追加項目</h3></div>
            <span className="rounded-full bg-card px-2.5 py-1 text-caption font-bold text-accent">{timelineSelected.length} / {limit}</span>
          </div>
          <p className="mb-2 text-micro text-muted2">入力フォームに追加した項目から選びます。感想もこの追加項目に含まれます</p>
          <div className="space-y-2">
            {selectable.filter((column) => selected.includes(column.index)).map((column) => {
              const checked = timelineSelected.includes(column.index);
              return <button key={column.index} type="button" onClick={() => toggleTimeline(column.index)} className={`flex min-h-12 w-full items-center gap-2 rounded-xl border px-3 text-left ${checked ? "border-accent/40 bg-accent/5" : "border-separator bg-card"}`}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? "border-accent bg-accent text-white" : "border-separator bg-card"}`}>{checked && <Check size={14} strokeWidth={3} />}</span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{column.label}</span>
              </button>;
            })}
            {selected.length === 0 && <p className="rounded-xl border border-dashed border-separator p-3 text-center text-caption text-muted">先に入力フォームへ項目を追加してください</p>}
          </div>
        </section>

        {message && <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-center text-caption font-semibold text-amber-800">{message}</p>}
        <FormModalFooter>
          <Button variant="outline" size="lg" onClick={onCancel} disabled={busy}>戻る</Button>
          <Button size="lg" onClick={confirm} disabled={busy}>{busy ? "保存中…" : "保存する"}</Button>
        </FormModalFooter>
      </div>
    </FormModal>
  );
}