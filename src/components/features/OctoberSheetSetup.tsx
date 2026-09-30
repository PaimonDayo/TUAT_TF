"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FormModal } from "@/components/ui/form-modal";
import { Button } from "@/components/ui/button";
import { SheetHeaderSetupDialog, type SheetHeaderData } from "./SheetHeaderSetupDialog";
import { SheetInputModeSetting } from "./SheetInputModeSetting";
import { OCTOBER_SHEET_ID, SHEET_SETUP_PATH } from "@/lib/sheet-period";
import { recordFieldsToJson } from "@/lib/profile-normalize";
import type { Profile, RecordFieldDef } from "@/types";

export function OctoberSheetSetup({ profile, prompt = false }: { profile: Profile; prompt?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const [members, setMembers] = useState<string[]>([]);
  const [sheetName, setSheetName] = useState(profile.sheet_name ?? "");
  const [mode, setMode] = useState<"sheet" | "app_only" | "off">(profile.sheet_transition?.mode ?? "sheet");
  const [header, setHeader] = useState<SheetHeaderData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (mode === "off") return;
    let active = true;
    void fetch("/api/sheets/october", { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      if (active) { setMembers(body.members.map((m: { name: string }) => m.name)); setLoaded(true); setError(null); }
    }).catch(e => { if (active) setError(e.message || "シートを取得できませんでした"); });
    return () => { active = false; };
  }, [attempt, mode]);

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
      if (!prompt) router.replace("/mypage/settings");
    } catch (e) { setError(e instanceof Error ? e.message : "保存できませんでした"); }
    finally { setBusy(false); }
  }
  if (!open || (prompt && [SHEET_SETUP_PATH, "/settings/sheet-setup"].includes(pathname))) return null;
  if (header && mode !== "off") return <SheetHeaderSetupDialog open data={header} initialFields={profile.sheet_transition ? profile.record_fields : []}
    isMiddleLong={profile.blocks.includes("middle_long")} busy={busy} error={error}
    inputMethod={<SheetInputModeSetting mode={mode} onChange={setMode} disabled={busy} />}
    onCancel={() => { if (!busy) setHeader(null); }} onConfirm={(fields, signature) => void save(fields, signature)} />;
  return <FormModal open title="記録の入力設定" autoFocus={false} onOpenChange={nextOpen => { if (!busy) { setOpen(nextOpen); if (!nextOpen && !prompt) router.replace("/mypage/settings"); } }}>
    <div className="space-y-5 p-4 pb-8">
      <p className="text-body">入力方法を選んでください。スプシと連携する場合は、自分のシートと入力・表示項目も確認します。</p>
      <SheetInputModeSetting mode={mode} onChange={nextMode => { setMode(nextMode); setError(null); }} disabled={busy} />
      {mode !== "off" && <>
      <a className="text-accent underline text-caption" href={`https://docs.google.com/spreadsheets/d/${OCTOBER_SHEET_ID}/edit`} target="_blank" rel="noreferrer">練習記録2026.10/1～を開く</a>
      <label className="block space-y-2"><span className="text-body font-semibold">自分のシート</span>
        <select className="w-full rounded-xl border border-separator bg-surface p-3" value={members.includes(sheetName) ? sheetName : ""} onChange={e => setSheetName(e.target.value)} disabled={busy || !loaded}>
          <option value="">{loaded ? "シートを選択" : "読み込み中…"}</option>
          {members.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      </>}
      <div className="space-y-2 text-caption text-muted">
        <p>設定を変更したいときは、マイページ → 設定 → 練習記録からいつでも開けます。変更して保存すると、その入力方法で同期します。設定変更だけでアプリの過去の記録が削除されることはありません。</p>
        <p>「両方から入力」に戻すと、同期対象期間のスプシの内容が再びアプリへ取り込まれます。スプシの列・見出しが変わった場合は、起動時に入力・表示項目を再確認します。</p>
        <p>連携中は9月以前の記録を旧スプシと10月7日いっぱいまで同期します。「スプシ連携しない」では、この同期も停止します。</p>
      </div>
      {error && <p role="alert" className="text-caption text-danger">{error}</p>}
      {mode !== "off" && !loaded && error && <Button onClick={() => setAttempt(value => value + 1)}>再試行</Button>}
      <Button className="w-full" disabled={busy || (mode !== "off" && (!loaded || !members.includes(sheetName)))} onClick={() => mode === "off" ? void save(profile.record_fields, "") : void next()}>{busy ? "処理中…" : mode === "off" ? "連携せずに保存" : "入力・表示項目を確認"}</Button>
    </div>
  </FormModal>;
}
