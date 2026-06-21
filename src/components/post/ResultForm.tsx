"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { PbRecord } from "@/types";

/**
 * 大会・記録会の結果の入力フォーム（追加・編集 共通）。
 * initial を渡すと編集モード。FAB・マイページの両方から使う。
 */
export function ResultForm({
  userId,
  initial,
  onDone,
}: {
  userId: string;
  initial?: PbRecord;
  onDone: (saved?: PbRecord) => void;
}) {
  const router = useRouter();
  const editing = !!initial;
  const [eventName, setEventName] = useState(initial?.event_name ?? "");
  const [record, setRecord] = useState(initial?.record ?? "");
  const [meetName, setMeetName] = useState(initial?.meet_name ?? "");
  const [recordedOn, setRecordedOn] = useState(initial?.recorded_on ?? "");
  const [isPb, setIsPb] = useState(initial?.is_pb ?? true);
  const [isUb, setIsUb] = useState(initial?.is_ub ?? false);
  const [isOfficial, setIsOfficial] = useState(initial?.is_official ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!eventName.trim() || !record.trim()) {
      setError("種目と記録を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      event_name: eventName.trim(),
      record: record.trim(),
      meet_name: meetName.trim() || null,
      recorded_on: recordedOn || null,
      is_pb: isPb,
      is_ub: isUb,
      is_official: isOfficial,
    };

    const { data, error } = editing
      ? await supabase.from("pb_records").update(payload).eq("id", initial!.id).select().single()
      : await supabase.from("pb_records").insert({ user_id: userId, ...payload }).select().single();

    if (error) {
      setError("保存に失敗しました");
      setSaving(false);
      return;
    }
    router.refresh();
    onDone(data as PbRecord);
  }

  return (
    <div className="space-y-4 pb-4">
      <div>
        <p className="section-label mb-1.5">種目</p>
        <Input
          placeholder="例: 5000m / 走幅跳 / 砲丸投"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
        />
      </div>
      <div>
        <p className="section-label mb-1.5">記録</p>
        <Input
          placeholder={`例: 15'32"4 / 6m85 / 14m20`}
          value={record}
          onChange={(e) => setRecord(e.target.value)}
        />
      </div>
      <div>
        <p className="section-label mb-1.5">大会名（任意）</p>
        <Input value={meetName} onChange={(e) => setMeetName(e.target.value)} />
      </div>
      <div>
        <p className="section-label mb-1.5">記録日（任意）</p>
        <Input type="date" value={recordedOn} onChange={(e) => setRecordedOn(e.target.value)} />
      </div>

      <ToggleRow label="PB（自己ベスト）として記録" value={isPb} onToggle={() => setIsPb((v) => !v)} />
      <ToggleRow label="UB として記録" value={isUb} onToggle={() => setIsUb((v) => !v)} />
      <ToggleRow label="公認記録" value={isOfficial} onToggle={() => setIsOfficial((v) => !v)} />

      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <Button size="lg" onClick={submit} disabled={saving}>
        {saving ? "保存中…" : editing ? "更新する" : "追加する"}
      </Button>
    </div>
  );
}

function ToggleRow({
  label,
  value,
  onToggle,
}: {
  label: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between rounded-xl bg-card border border-separator p-3.5 active:bg-bg"
    >
      <span className="text-[14px]">{label}</span>
      <span
        className="h-6 w-10 rounded-full p-0.5 transition-colors flex"
        style={{
          backgroundColor: value ? "#34c759" : "#e5e5ea",
          justifyContent: value ? "flex-end" : "flex-start",
        }}
      >
        <span className="h-5 w-5 rounded-full bg-white shadow" />
      </span>
    </button>
  );
}
