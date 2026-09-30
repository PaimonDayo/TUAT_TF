"use client";

export function SheetInputModeSetting({ mode, onChange, disabled = false }: {
  mode: "sheet" | "app_only";
  onChange: (mode: "sheet" | "app_only") => void;
  disabled?: boolean;
}) {
  return <div className="space-y-3">
    <p className="rounded-xl bg-accent/10 p-3 text-caption">アプリだけで記録を入力する方は、同期処理の負荷を減らすため、できる限り「アプリからのみ入力」を選んでください。アプリの記録は引き続きスプシへ反映されます。</p>
    <fieldset disabled={disabled} className="space-y-3"><legend className="mb-2 text-body font-semibold">入力方法</legend>
      <label className="flex gap-3 rounded-xl border border-separator p-3"><input type="radio" name="sheet-mode" checked={mode === "sheet"} onChange={() => onChange("sheet")} /><span>スプシとアプリの両方から入力<span className="block text-caption text-muted">スプシの変更をアプリへ取り込み、アプリで入力した記録もスプシへ反映します。</span></span></label>
      <label className="flex gap-3 rounded-xl border border-separator p-3"><input type="radio" name="sheet-mode" checked={mode === "app_only"} onChange={() => onChange("app_only")} /><span>アプリからのみ入力<span className="block text-caption text-muted">アプリの記録をスプシへ反映します。</span></span></label>
    </fieldset>
    {mode === "app_only" && <p role="note" className="rounded-xl bg-accent/10 p-3 text-caption">スプシに入力・変更した内容はアプリに反映されません。スプシ上の返信も取り込みません。記録はアプリから入力してください。</p>}
  </div>;
}
