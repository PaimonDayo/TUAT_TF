"use client";

import { useState } from "react";
import { Close as DialogClose } from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { FormDraftGuard, FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { SheetInputModeSetting } from "./SheetInputModeSetting";
import { SheetHeaderSetupDialog, type SheetHeaderData } from "./SheetHeaderSetupDialog";
import { recordFieldsToJson } from "@/lib/profile-normalize";
import { SHEET_INPUT_MODE_LABELS } from "@/lib/sheet-input-mode";
import type { RecordFieldDef } from "@/types";

type Mode = "sheet" | "app_only" | "off";
export type AdminSheetSetup = {
  revision: string; fields: RecordFieldDef[]; sheetName: string | null;
  mode: Mode | null; signature: string | null; isMiddleLong: boolean;
};
type SaveIntent = AdminSheetSetup & { mode: Mode };

export function matchesAdminSheetSetup(latest: AdminSheetSetup, intent: SaveIntent) {
  return latest.revision !== intent.revision && latest.mode === intent.mode && latest.sheetName === intent.sheetName && latest.signature === intent.signature
    && JSON.stringify(recordFieldsToJson(latest.fields)) === JSON.stringify(recordFieldsToJson(intent.fields));
}

/** 開閉しても保存結果不明の操作を保持し、設定の読取で確認するまで再送しない。 */
export function AdminSheetSetupEditor({ memberId, memberName, onSaved, onNotice }: {
  memberId: string; memberName: string; onSaved: (setup: AdminSheetSetup) => void; onNotice: (message: string) => void;
}) {
  const endpoint = `/api/admin/sheets/${encodeURIComponent(memberId)}`;
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<AdminSheetSetup | null>(null);
  const [mode, setMode] = useState<Mode>("sheet");
  const [sheetName, setSheetName] = useState("");
  const [members, setMembers] = useState<{ name: string; gid: string }[]>([]);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [header, setHeader] = useState<SheetHeaderData | null>(null);
  const [sequence, setSequence] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verification, setVerification] = useState<"uncertain" | "conflict" | null>(null);
  const [intent, setIntent] = useState<SaveIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = loading || saving;

  async function read<T>(query: string): Promise<T> {
    const response = await fetch(`${endpoint}?${query}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "設定を取得できませんでした。もう一度お試しください");
    return body;
  }
  async function loadMembers() {
    setMembersLoading(true); setMemberError(null);
    try { setMembers((await read<{ members: { name: string; gid: string }[] }>("view=members")).members); }
    catch { setMemberError("シート一覧を取得できませんでした。もう一度読み込んでください"); }
    finally { setMembersLoading(false); }
  }
  function adopt(latest: AdminSheetSetup) {
    setSnapshot(latest); setMode(latest.mode ?? "sheet"); setSheetName(latest.mode ? latest.sheetName ?? "" : "");
    setHeader(null); setSequence((value) => value + 1); setVerification(null); setIntent(null);
  }
  function finish(latest: AdminSheetSetup, message: string) {
    onSaved(latest); onNotice(message); setOpen(false); setHeader(null); setVerification(null); setIntent(null); setError(null);
  }
  async function openEditor() {
    setLoading(true); setError(null);
    try {
      const latest = await read<AdminSheetSetup>("view=settings");
      if (verification === "uncertain" && intent && matchesAdminSheetSetup(latest, intent)) {
        finish(latest, "連携設定が保存されていることを確認しました");
      } else {
        if (verification === "uncertain" && intent && latest.revision === intent.revision) {
          setSnapshot(latest); setHeader(null);
          setError("保存結果はまだ確認できません。時間をおいて保存結果を再確認してください");
        } else { adopt(latest); }
        setOpen(true); void loadMembers();
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "設定を取得できませんでした"); }
    finally { setLoading(false); }
  }
  function close() {
    if (busy) return;
    if (verification === "uncertain") onNotice("保存結果は未確認です。再び編集を開いて保存結果を確認してください");
    else { setVerification(null); setIntent(null); }
    setOpen(false); setHeader(null); setError(null);
  }
  async function verify() {
    setLoading(true);
    try {
      const latest = await read<AdminSheetSetup>("view=settings");
      if (verification === "uncertain" && intent && matchesAdminSheetSetup(latest, intent)) {
        finish(latest, "連携設定が保存されていることを確認しました");
      } else if (verification === "uncertain" && intent && latest.revision === intent.revision) {
        setError("現在確認できる設定は保存前と同じです。時間をおいて保存結果を再確認してください");
      } else {
        adopt(latest); setError("現在の設定を読み直しました。内容を確認してから編集してください");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "設定を確認できませんでした"); }
    finally { setLoading(false); }
  }
  async function save(fields: RecordFieldDef[], signature: string | null) {
    if (!snapshot || busy || verification) return;
    const next: SaveIntent = mode === "off" ? { ...snapshot, mode }
      : { ...snapshot, mode, sheetName, fields, signature };
    setSaving(true); setError(null); setIntent(next);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: snapshot.revision, mode, sheetName: next.sheetName, fields: recordFieldsToJson(next.fields), signature: next.signature }) });
      const body = await response.json();
      if (!response.ok) {
        if (body.uncertain === true) setVerification("uncertain");
        else if (response.status === 409) setVerification("conflict");
        setError(body.error || "保存できませんでした。設定を確認してください"); return;
      }
      finish(next, "連携設定を保存しました");
    } catch {
      setVerification("uncertain"); setError("保存結果を確認できませんでした。保存結果を確認してから操作してください");
    } finally { setSaving(false); }
  }
  async function next() {
    if (!snapshot || busy || verification) return;
    if (mode === "off") { await save(snapshot.fields, snapshot.signature); return; }
    if (!sheetName) { setError("連携シートを選択してください"); return; }
    setLoading(true); setError(null);
    try {
      const result = await read<{ revision: string; header: SheetHeaderData; isMiddleLong: boolean }>(`sheetName=${encodeURIComponent(sheetName)}`);
      if (result.revision !== snapshot.revision) {
        setVerification("conflict"); setError("設定が変更されています。現在の設定を読み直してください");
      } else {
        setSnapshot({ ...snapshot, isMiddleLong: result.isMiddleLong }); setSheetName(result.header.sheetName);
        setHeader(result.header); setSequence((value) => value + 1);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "項目を取得できませんでした"); }
    finally { setLoading(false); }
  }
  const recovery = verification && <div className="m-4 flex flex-wrap gap-2">
    <Button disabled={busy} onClick={() => void verify()}>{verification === "uncertain" ? "保存結果を確認" : "現在の設定を読み直す"}</Button>
    <Button variant="outline" disabled={busy} onClick={close}>編集を閉じる</Button>
  </div>;
  return <>
    <Button className="w-full" disabled={loading} onClick={() => void openEditor()}>{loading && !open ? "読み込み中…" : "連携設定を編集"}</Button>
    {error && !open && <p role="alert" className="text-caption text-danger">{error}</p>}
    {open && snapshot && (header ? <SheetHeaderSetupDialog key={`${snapshot.revision}-${sequence}`} open data={header}
      initialFields={snapshot.mode === null ? [] : snapshot.fields} isMiddleLong={snapshot.isMiddleLong}
      busy={busy} locked={verification !== null} error={error} onCancel={() => { setHeader(null); setError(null); }}
      inputMethod={<p className="text-caption">入力方法: {SHEET_INPUT_MODE_LABELS[mode]}</p>}
      onConfirm={(fields, signature) => void save(fields, signature)} context={<p className="m-4 text-caption font-semibold">{memberName} · 2026年10月1日以降</p>}
      recovery={recovery} /> : <FormModal open onOpenChange={(value) => { if (!value) close(); }} title="連携設定を編集">
        <FormDraftGuard dirty={!verification && (mode !== (snapshot.mode ?? "sheet") || sheetName !== (snapshot.mode ? snapshot.sheetName ?? "" : ""))} busy={busy} onSave={next} />
        <div className="space-y-4 p-4">
          <p className="text-caption font-semibold">{memberName} · 2026年10月1日以降</p>
          <SheetInputModeSetting mode={mode} onChange={setMode} disabled={busy || !!verification} />
          {mode !== "off" && <div className="space-y-2">
            <label htmlFor="admin-sheet-name" className="block text-body font-semibold">連携シート</label>
            <select id="admin-sheet-name" className="w-full rounded-xl border border-separator bg-surface p-3 text-body" value={sheetName} onChange={(event) => setSheetName(event.target.value)} disabled={busy || membersLoading || !!verification}>
              <option value="">シートを選択</option>
              {sheetName && !members.some((member) => member.name === sheetName) && <option value={sheetName}>{sheetName}（現在の設定）</option>}
              {members.map((member) => <option key={member.gid} value={member.name}>{member.name}</option>)}
            </select>
            {membersLoading && <p role="status" className="text-caption text-muted2">シート一覧を読み込み中…</p>}
            {memberError && <><p role="alert" className="text-caption text-danger">{memberError}</p><Button variant="outline" disabled={busy} onClick={() => void loadMembers()}>シート一覧を再読み込み</Button></>}
            <p className="text-micro text-muted2">次の画面で入力項目とタイムラインの表示項目を確認します。</p>
          </div>}
          {error && <p role="alert" className="text-caption text-danger">{error}</p>}
        </div>
        {recovery}
        <FormModalFooter><div className="flex gap-2 p-4"><DialogClose asChild><Button variant="outline" disabled={busy}>キャンセル</Button></DialogClose><Button className="flex-1" disabled={busy || !!verification || (mode !== "off" && !sheetName)} onClick={() => void next()}>{saving ? "保存中…" : mode === "off" ? "保存する" : "項目を確認"}</Button></div></FormModalFooter>
      </FormModal>)}
  </>;
}
