"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { FormModalFooter } from "@/components/ui/form-modal";
import type { PbRecord } from "@/types";

/**
 * 大会・記録会の結果の入力フォーム（追加・編集 共通）。
 * initial を渡すと編集モード。FAB・マイページの両方から使う。
 */
export type ResultFormHandle = { save: () => void };
export const ResultForm = forwardRef<ResultFormHandle, { userId: string; initial?: PbRecord; onDone: (saved?: PbRecord) => void; onDirtyChange?: (dirty: boolean) => void }>(function ResultForm({ userId, initial, onDone, onDirtyChange }, ref) {
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
  const [touched, setTouched] = useState(false);
  useEffect(() => { onDirtyChange?.(touched); }, [onDirtyChange, touched]);
  useImperativeHandle(ref, () => ({ save: () => { void submit(); } }));

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
    <div className="space-y-4 pb-4" onInputCapture={() => setTouched(true)} onClickCapture={(event) => { if ((event.target as Element).closest("button")) setTouched(true); }}>
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

      <Toggle label="PB（自己ベスト）として記録" checked={isPb} onChange={() => setIsPb((v) => !v)} />
      <Toggle label="UB として記録" checked={isUb} onChange={() => setIsUb((v) => !v)} />
      <Toggle label="公認記録" checked={isOfficial} onChange={() => setIsOfficial((v) => !v)} />

      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <FormModalFooter>
        <Button size="lg" onClick={submit} disabled={saving}>
          {saving ? <><LoaderCircle size={18} className="animate-spin" />保存しています…</> : editing ? "更新する" : "追加する"}
        </Button>
      </FormModalFooter>
    </div>
  );
});
