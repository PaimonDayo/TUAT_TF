"use client";

import { SHEET_INPUT_MODE_LABELS } from "@/lib/sheet-input-mode";

export function SheetInputModeSetting({ mode, onChange, disabled = false }: {
  mode: "sheet" | "app_only" | "off";
  onChange: (mode: "sheet" | "app_only" | "off") => void;
  disabled?: boolean;
}) {
  return <div className="space-y-3">
    <p className="rounded-xl bg-accent/10 p-3 text-caption">アプリだけで記録を入力する方は、読み込みの負荷を減らすため、できる限り「{SHEET_INPUT_MODE_LABELS.app_only}」を選んでください。アプリの記録は引き続きスプレッドシートへ書き込まれます。スプレッドシートへの保存も不要な方は「{SHEET_INPUT_MODE_LABELS.off}」を選んでください。</p>
    <fieldset disabled={disabled} className="space-y-3"><legend className="mb-2 text-body font-semibold">入力方法</legend>
      <label data-ui-choice-row className="flex gap-3 rounded-xl border border-separator p-3"><input className="mt-1 h-4 w-4 shrink-0 self-start" type="radio" name="sheet-mode" checked={mode === "sheet"} onChange={() => onChange("sheet")} /><span>{SHEET_INPUT_MODE_LABELS.sheet}<span className="block text-caption text-muted">スプレッドシートの変更をアプリへ取り込み、アプリで入力した記録もスプレッドシートへ書き込みます。</span></span></label>
      <label data-ui-choice-row className="flex gap-3 rounded-xl border border-separator p-3"><input className="mt-1 h-4 w-4 shrink-0 self-start" type="radio" name="sheet-mode" checked={mode === "app_only"} onChange={() => onChange("app_only")} /><span>{SHEET_INPUT_MODE_LABELS.app_only}<span className="block text-caption text-muted">アプリの記録をスプレッドシートへ書き込みます。</span></span></label>
      <label data-ui-choice-row className="flex gap-3 rounded-xl border border-separator p-3"><input className="mt-1 h-4 w-4 shrink-0 self-start" type="radio" name="sheet-mode" checked={mode === "off"} onChange={() => onChange("off")} /><span>{SHEET_INPUT_MODE_LABELS.off}<span className="block text-caption text-muted">アプリ内だけに保存します。スプレッドシートへの書き込み・取り込みを停止します。</span></span></label>
    </fieldset>
    {mode === "off" && <p role="note" className="rounded-xl bg-accent/10 p-3 text-caption">9月以前の記録を含め、記録・コメント・削除の連携を停止します。アプリとスプレッドシートに保存済みの内容は削除しません。再び連携すると、送信待ちの記録や削除も連携の対象になります。</p>}
    {mode === "app_only" && <p role="note" className="rounded-xl bg-accent/10 p-3 text-caption">スプレッドシートに入力・変更した内容はアプリに取り込みません。スプレッドシート上の返信も取り込みません。記録はアプリから入力してください。</p>}
  </div>;
}
