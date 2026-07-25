"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import {
  buildSheetRecordFields,
  inferSheetFieldType,
  isFixedSheetColumn,
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
  isMiddleLong,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  data: SheetHeaderData;
  isMiddleLong: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (fields: RecordFieldDef[], signature: string) => void;
}) {
  const selectable = useMemo(
    () => data.columns.filter((column) => !isFixedSheetColumn(column.label, isMiddleLong)),
    [data, isMiddleLong],
  );
  const [selected, setSelected] = useState<number[]>(() => selectable.map((column) => column.index));
  const [types, setTypes] = useState<Record<number, "text" | "number">>(() =>
    Object.fromEntries(selectable.map((column) => [column.index, inferSheetFieldType(column.label)])),
  );
  const [memoColumn, setMemoColumn] = useState<number | null>(() =>
    data.memoCandidates.length === 1 ? data.memoCandidates[0] : null,
  );
  const needsMemoChoice = data.memoCandidates.length > 1 && memoColumn === null;

  function confirm() {
    if (needsMemoChoice) return;
    onConfirm(buildSheetRecordFields({
      columns: data.columns,
      selectedColumns: selected,
      types,
      isMiddleLong,
      memoColumn,
    }), data.signature);
  }

  return (
    <FormModal open={open} onOpenChange={(next) => !next && onCancel()} title="スプシの入力項目を確認" autoFocus={false}>
      <div className="space-y-4 pb-5">
        <div className="rounded-xl bg-accent/8 px-3 py-2.5 text-caption leading-relaxed">
          「{data.sheetName}」の見出しを取得しました。アプリの入力フォームに使う列と入力形式を選んでください。
          列名が変わった場合も、この画面で再確認してから同期します。
        </div>

        <div className="rounded-xl border border-separator bg-card p-3">
          <p className="text-[14px] font-semibold">固定項目</p>
          <p className="mt-1 text-caption text-muted2">
            日付{isMiddleLong ? "・低強度・中強度・高強度・解糖系" : ""}は自動で対応します。
            {isMiddleLong && " 強度別がすべて空欄の記録だけ、実際の距離を合計表示に使います。"}
          </p>
        </div>

        {data.memoCandidates.length > 1 && (
          <fieldset className="rounded-xl border border-amber-300 bg-amber-50 p-3">
            <legend className="px-1 text-[13px] font-semibold">感想として使う列を選択</legend>
            <p className="mb-2 text-micro text-muted2">候補が複数あるため、自動決定せず確認しています。</p>
            <div className="space-y-2">
              {data.memoCandidates.map((columnIndex) => {
                const column = data.columns.find((item) => item.index === columnIndex)!;
                return <label key={columnIndex} className="flex items-center gap-2 text-caption"><input type="radio" name="memo-column" checked={memoColumn === columnIndex} onChange={() => setMemoColumn(columnIndex)} />{column.label}</label>;
              })}
            </div>
          </fieldset>
        )}

        <div className="space-y-2">
          {selectable.map((column) => {
            const checked = selected.includes(column.index);
            return (
              <div key={column.index} className="rounded-xl border border-separator bg-card p-3">
                <label className="flex items-center gap-2 text-[14px] font-semibold">
                  <input type="checkbox" checked={checked} onChange={() => setSelected((current) => checked ? current.filter((value) => value !== column.index) : [...current, column.index])} />
                  <span className="min-w-0 flex-1 truncate">{column.label}</span>
                  <span className="text-micro text-muted">{column.index + 1}列目</span>
                </label>
                {checked && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {(["text", "number"] as const).map((type) => (
                      <button key={type} type="button" onClick={() => setTypes((current) => ({ ...current, [column.index]: type }))} className={`h-9 rounded-lg border text-caption font-semibold ${types[column.index] === type ? "border-accent bg-accent/10 text-accent" : "border-separator text-muted2"}`}>
                        {type === "text" ? "文字列" : "数値"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {needsMemoChoice && <p className="text-center text-caption text-danger">感想として使う列を選んでください</p>}
        <FormModalFooter>
          <Button variant="outline" size="lg" onClick={onCancel} disabled={busy}>戻る</Button>
          <Button size="lg" onClick={confirm} disabled={busy || needsMemoChoice}>{busy ? "保存中…" : "この設定で保存"}</Button>
        </FormModalFooter>
      </div>
    </FormModal>
  );
}
