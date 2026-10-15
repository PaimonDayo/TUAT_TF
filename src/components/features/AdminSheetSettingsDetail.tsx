"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented";
import { SheetHeaderSetupDialog, type SheetHeaderData } from "@/components/features/SheetHeaderSetupDialog";
import { gradeShort } from "@/lib/constants";
import { recordFieldsToJson } from "@/lib/profile-normalize";
import type { MemberSheetSettingsDetail, SheetSettingsPeriod } from "@/lib/queries";
import { isFixedSheetColumn } from "@/lib/sheet-field-config";
import { SHEET_INPUT_MODE_LABELS } from "@/lib/sheet-input-mode";
import type { RecordFieldDef } from "@/types";

type EditorData = { revision: string; fields: RecordFieldDef[]; header: SheetHeaderData; isMiddleLong: boolean };
type SaveIntent = { revision: string; fields: RecordFieldDef[]; signature: string };

function matchesIntent(latest: EditorData, intent: SaveIntent) {
  return JSON.stringify(recordFieldsToJson(latest.fields)) === JSON.stringify(recordFieldsToJson(intent.fields))
    && latest.header.signature === intent.signature;
}

export function AdminSheetSettingsDetail({ member }: { member: MemberSheetSettingsDetail }) {
  const router = useRouter();
  const [periodId, setPeriodId] = useState<SheetSettingsPeriod["id"]>("october");
  const [editor, setEditor] = useState<EditorData | null>(null);
  const [editorSequence, setEditorSequence] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verification, setVerification] = useState<"uncertain" | "conflict" | null>(null);
  const [intent, setIntent] = useState<SaveIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ base: MemberSheetSettingsDetail; fields: RecordFieldDef[] } | null>(null);
  const period = member.periods.find((value) => value.id === periodId)!;
  const fields = period.id === "october" && saved?.base === member ? saved.fields : period.fields;
  const visibleFields = fields.filter((field) => !field.hidden);
  const timelineFields = visibleFields.filter((field) => field.showInTimeline === true);
  const hasTimelineConfig = fields.some((field) => typeof field.showInTimeline === "boolean");
  const isMiddleLong = member.blocks.includes("middle_long");
  const endpoint = `/api/admin/sheets/${encodeURIComponent(member.id)}`;

  async function readEditor(): Promise<EditorData> {
    const response = await fetch(endpoint, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "設定を取得できませんでした。もう一度お試しください");
    return body;
  }

  async function openEditor() {
    setLoading(true); setError(null); setNotice(null);
    try {
      const latest = await readEditor();
      if (verification === "uncertain" && intent && matchesIntent(latest, intent)) {
        finishSave(latest.fields, "連携項目が保存されていることを確認しました");
      } else {
        setEditor(latest); setEditorSequence((value) => value + 1);
        if (verification === "uncertain" && intent && latest.revision === intent.revision) {
          setError("保存結果はまだ確認できません。時間をおいて保存結果を再確認してください");
        } else { setVerification(null); setIntent(null); }
      }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "設定を取得できませんでした。もう一度お試しください"); }
    finally { setLoading(false); }
  }

  function finishSave(fields: RecordFieldDef[], message: string) {
    setSaved({ base: member, fields }); setEditor(null); setVerification(null); setIntent(null); setError(null); setNotice(message);
    router.refresh();
  }

  async function save(fields: RecordFieldDef[], signature: string) {
    if (!editor || saving || verification) return;
    setSaving(true); setError(null); setIntent({ revision: editor.revision, fields, signature });
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ revision: editor.revision, fields: recordFieldsToJson(fields), signature }) });
      const body = await response.json();
      if (!response.ok) {
        if (body.uncertain === true) setVerification("uncertain");
        else if (response.status === 409) setVerification("conflict");
        setError(body.error || "保存できませんでした。設定を確認してください");
        return;
      }
      finishSave(fields, "連携項目を保存しました");
    } catch {
      setVerification("uncertain");
      setError("保存結果を確認できませんでした。保存結果を確認してから操作してください");
    } finally { setSaving(false); }
  }

  async function verifySave() {
    if (!editor) return;
    setLoading(true);
    try {
      const latest = await readEditor();
      if (verification === "uncertain" && intent && matchesIntent(latest, intent)) {
        finishSave(latest.fields, "連携項目が保存されていることを確認しました");
      } else if (verification === "uncertain" && intent && latest.revision === intent.revision) {
        setError("現在確認できる設定は保存前と同じです。時間をおいて保存結果を再確認してください");
      } else {
        setEditor(latest); setEditorSequence((value) => value + 1); setSaved({ base: member, fields: latest.fields }); setVerification(null); setIntent(null);
        setError("現在の設定を読み直しました。内容を確認してから編集してください");
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "設定を確認できませんでした。もう一度お試しください"); }
    finally { setLoading(false); }
  }

  function closeEditor() {
    if (saving || loading) return;
    if (verification === "uncertain") setNotice("保存結果は未確認です。項目を編集する前に現在の設定を確認してください");
    setEditor(null); setError(null);
    if (verification !== "uncertain") { setVerification(null); setIntent(null); }
    router.refresh();
  }

  return <div className="space-y-4 px-4 pb-6 pt-2">
    <Card className="flex items-center gap-3 p-3">
      <Avatar name={member.display_name || "?"} avatarUrl={member.avatar_url} blocks={member.blocks} size="sm" />
      <div className="min-w-0 flex-1"><h1 className="break-words text-[15px] font-semibold">{member.display_name || "名前未設定"}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-2"><BlockPills blocks={member.blocks} /><span className="text-micro text-muted2">{gradeShort(member.grade)}{member.status === "graduated" ? "・卒業" : ""}</span></div>
      </div>
    </Card>
    <SegmentedControl items={[{ key: "october", label: "10月1日以降" }, { key: "legacy", label: "9月30日以前" }]} value={periodId} onChange={(value) => { setPeriodId(value === "legacy" ? "legacy" : "october"); setError(null); }} />
    <section className="space-y-3" aria-label={period.label}>
      <h2 className="section-label">{period.label}</h2>
      <Card className="space-y-4 p-4">
        <dl className="space-y-4 text-caption">
          <div><dt className="text-muted2">連携シート</dt><dd className="mt-1 break-words">{period.sheet_name || "未選択"}</dd></div>
          <div><dt className="text-muted2">入力方法</dt><dd className="mt-1">{period.mode ? SHEET_INPUT_MODE_LABELS[period.mode] : "この期間の設定は未確認です"}</dd></div>
          <div><dt className="text-muted2">入力フォームの項目</dt><dd className="mt-1"><FieldList fields={visibleFields} isMiddleLong={isMiddleLong} empty="保存された項目はありません" /></dd></div>
          <div><dt className="text-muted2">タイムラインに表示する項目</dt><dd className="mt-1">{hasTimelineConfig
            ? <FieldList fields={timelineFields} isMiddleLong={isMiddleLong} empty="表示する項目はありません" />
            : <span>{period.mode === null ? "この期間の設定は未確認です" : "標準の表示（保存済みの非表示設定を使用）"}</span>}</dd></div>
        </dl>
        {period.editable ? <>
          <p className="text-micro text-muted2">変更は今後保存する記録に使われます。記録に保存済みの表示設定は維持されます。</p>
          <Button className="w-full" disabled={loading} onClick={() => void openEditor()}>{loading ? "読み込み中…" : "連携項目を編集"}</Button>
        </> : <p className="text-caption text-muted2">{period.id === "legacy" ? "この期間の連携は終了しています。保存された設定を確認できます。" : period.mode === "off" ? "スプレッドシートとの連携を停止しています。本人の入力フォームの設定を表示しています。" : "本人の設定で、連携シートと入力方法を確認してから編集できます。"}</p>}
      </Card>
    </section>
    {notice && <p role="status" className="text-caption text-muted2">{notice}</p>}
    {error && !editor && <p role="alert" className="text-caption text-danger">{error}</p>}
    {editor && <SheetHeaderSetupDialog key={`${editor.revision}-${editorSequence}`} open data={editor.header} initialFields={editor.fields} isMiddleLong={editor.isMiddleLong}
      busy={saving || loading} locked={verification !== null} error={error} onCancel={closeEditor} onConfirm={(fields, signature) => void save(fields, signature)}
      context={<p className="m-4 text-caption font-semibold">{member.display_name} · 2026年10月1日以降</p>}
      recovery={verification && <div className="m-4 flex flex-wrap gap-2">
        <Button disabled={loading || saving} onClick={() => void verifySave()}>{verification === "uncertain" ? "保存結果を確認" : "現在の設定を読み直す"}</Button>
        <Button variant="outline" disabled={loading || saving} onClick={closeEditor}>編集を閉じる</Button>
      </div>} />}
  </div>;
}

function FieldList({ fields, isMiddleLong, empty }: { fields: RecordFieldDef[]; isMiddleLong: boolean; empty: string }) {
  if (fields.length === 0) return <span>{empty}</span>;
  return <ul className="flex flex-wrap gap-1.5">{fields.map((field, index) => <li key={`${field.key}-${index}`} className="max-w-full break-words rounded-lg bg-accent/8 px-2 py-1">
    {field.label}{field.sourceColumn !== undefined && isFixedSheetColumn(field.sourceHeader ?? field.label, isMiddleLong) && <span className="text-muted2">（標準）</span>}
  </li>)}</ul>;
}
