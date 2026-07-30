"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import { SheetHeaderSetupDialog, type SheetHeaderData } from "@/components/features/SheetHeaderSetupDialog";
import { recordFieldsToJson } from "@/lib/profile-normalize";
import type { RecordFieldDef } from "@/types";

export function SheetRecordFormSetting({
  sheetName,
  initial,
  isMiddleLong,
}: {
  sheetName: string;
  initial: RecordFieldDef[];
  isMiddleLong: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState<SheetHeaderData | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function openEditor() {
    setLoading(true);
    setMessage(null);
    const response = await fetch(`/api/sheets/header?sheetName=${encodeURIComponent(sheetName)}`, { cache: "no-store" });
    const body = await response.json().catch(() => ({})) as SheetHeaderData & { error?: string };
    setLoading(false);
    if (!response.ok) {
      setMessage(body.error ?? "スプレッドシートの見出しを取得できませんでした");
      return;
    }
    setData(body);
  }

  async function save(fields: RecordFieldDef[], signature: string) {
    setSaving(true);
    setMessage(null);
    const response = await fetch("/api/record-form-config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: recordFieldsToJson(fields), signature }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setSaving(false);
    if (!response.ok) {
      setMessage(body.error ?? "設定を保存できませんでした");
      return;
    }
    setData(null);
    router.refresh();
  }

  return <>
    <button type="button" onClick={() => void openEditor()} disabled={loading} className="flex w-full items-center gap-3 rounded-xl border border-separator bg-card p-3 text-left active:bg-bg disabled:opacity-60">
      <SlidersHorizontal size={19} className="text-accent" />
      <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold">練習記録フォーム・タイムライン表示</span><span className="block text-micro text-muted">スプレッドシートの列から入力項目と表示項目を設定</span></span>
      <ChevronRight size={18} className="text-muted" />
    </button>
    {loading && <p className="px-1 text-micro text-muted">見出しを取得中…</p>}
    {message && <p className="rounded-lg bg-danger/10 px-3 py-2 text-caption text-danger">{message}</p>}
    {data && <SheetHeaderSetupDialog
      key={data.signature}
      open
      data={data}
      initialFields={initial}
      isMiddleLong={isMiddleLong}
      busy={saving}
      onCancel={() => setData(null)}
      onConfirm={(fields, signature) => void save(fields, signature)}
    />}
  </>;
}