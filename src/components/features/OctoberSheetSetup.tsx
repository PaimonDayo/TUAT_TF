"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FormModal } from "@/components/ui/form-modal";
import { Button } from "@/components/ui/button";
import { SheetHeaderSetupDialog, type SheetHeaderData } from "./SheetHeaderSetupDialog";
import { OCTOBER_SHEET_ID } from "@/lib/sheet-period";
import { recordFieldsToJson } from "@/lib/profile-normalize";
import type { Profile, RecordFieldDef } from "@/types";

export function OctoberSheetSetup({ profile, prompt = false }: { profile: Profile; prompt?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [members, setMembers] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState(profile.sheet_name ?? "");
  const [mode, setMode] = useState<"sheet" | "app_only">(profile.sheet_transition?.mode ?? "sheet");
  const [header, setHeader] = useState<SheetHeaderData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void fetch("/api/sheets/october", { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (active) { setMembers(body.members.map((m: { name: string }) => m.name)); setLoaded(true); setError(null); }
    }).catch(e => { if (active) setError(e.message || "シートを取得できませんでした"); });
    return () => { active = false; };
  }, [attempt]);

  async function next() {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/sheets/october?sheetName=${encodeURIComponent(sheetName)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setHeader(body);
    } catch (e) { setError(e instanceof Error ? e.message : "見出しを取得できませんでした"); }
    finally { setBusy(false); }
  }
  async function save(fields: RecordFieldDef[], signature: string) {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/sheets/october", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sheetName, mode, fields: recordFieldsToJson(fields), signature }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setOpen(false); setHeader(null); router.refresh();
      if (!prompt) router.replace("/home");
    } catch (e) { setError(e instanceof Error ? e.message : "保存できませんでした"); }
    finally { setBusy(false); }
  }
  if (!open || (prompt && pathname === "/settings/sheet-setup")) return null;
  if (header) return <SheetHeaderSetupDialog open data={header} initialFields={profile.sheet_transition ? profile.record_fields : []}
    isMiddleLong={profile.blocks.includes("middle_long")} busy={busy} error={error}
    onCancel={() => { if (!busy) setHeader(null); }} onConfirm={(fields, signature) => void save(fields, signature)} />;
  return <FormModal open title="10月からの入力設定" autoFocus={false} onOpenChange={nextOpen => { if (!busy) setOpen(nextOpen); }}>
    <div className="space-y-5 p-4 pb-8">
      <p className="text-body">新しいスプレッドシートで、自分のシートと入力方法を確認してください。次に入力フォームとタイムラインの表示項目を選びます。</p>
      <a className="text-accent underline text-caption" href={`https://docs.google.com/spreadsheets/d/${OCTOBER_SHEET_ID}/edit`} target="_blank" rel="noreferrer">練習記録2026.10/1～を開く</a>
      <label className="block space-y-2"><span className="text-body font-semibold">自分のシート</span>
        <select className="w-full rounded-xl border border-separator bg-surface p-3" value={members.includes(sheetName) ? sheetName : ""} onChange={e => setSheetName(e.target.value)} disabled={busy || !loaded}>
          <option value="">{loaded ? "シートを選択" : "読み込み中…"}</option>
          {members.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <p className="rounded-xl bg-accent/10 p-3 text-caption">アプリだけで記録を入力する方は、同期処理の負荷を減らすため、できる限り「アプリからのみ入力」を選んでください。アプリの記録は引き続きスプシへ反映されます。</p>
      <fieldset disabled={busy} className="space-y-3"><legend className="mb-2 text-body font-semibold">入力方法</legend>
        <label className="flex gap-3 rounded-xl border border-separator p-3"><input type="radio" name="sheet-mode" checked={mode === "sheet"} onChange={() => setMode("sheet")} /><span>スプシとアプリの両方から入力<span className="block text-caption text-muted">スプシの変更をアプリへ取り込み、アプリで入力した記録もスプシへ反映します。</span></span></label>
        <label className="flex gap-3 rounded-xl border border-separator p-3"><input type="radio" name="sheet-mode" checked={mode === "app_only"} onChange={() => setMode("app_only")} /><span>アプリからのみ入力<span className="block text-caption text-muted">アプリの記録をスプシへ反映します。</span></span></label>
      </fieldset>
      {mode === "app_only" && <p role="note" className="rounded-xl bg-accent/10 p-3 text-caption">スプシに入力・変更した内容はアプリに反映されません。スプシ上の返信も取り込みません。記録はアプリから入力してください。</p>}
      <div className="space-y-2 text-caption text-muted">
        <p>設定を変更したいときは、ホームの「記録の入力設定」からいつでも開けます。変更して保存すると、その入力方法で同期します。設定変更だけでアプリの過去の記録が削除されることはありません。</p>
        <p>「両方から入力」に戻すと、同期対象期間のスプシの内容が再びアプリへ取り込まれます。スプシの列・見出しが変わった場合は、起動時に入力・表示項目を再確認します。</p>
        <p>9月以前の記録は旧スプシと10月7日いっぱいまで同期します。</p>
      </div>
      {error && <p role="alert" className="text-caption text-danger">{error}</p>}
      {!loaded && error && <Button onClick={() => setAttempt(value => value + 1)}>再試行</Button>}
      <Button className="w-full" disabled={busy || !loaded || !members.includes(sheetName)} onClick={() => void next()}>{busy ? "取得中…" : "入力・表示項目を確認"}</Button>
    </div>
  </FormModal>;
}
