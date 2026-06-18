"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { PbRecord } from "@/types";

export function PbManager({
  userId,
  initial,
}: {
  userId: string;
  initial: PbRecord[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<PbRecord[]>(initial);
  const [open, setOpen] = useState(false);

  async function remove(id: string) {
    setItems((arr) => arr.filter((x) => x.id !== id));
    const supabase = createClient();
    await supabase.from("pb_records").delete().eq("id", id);
    router.refresh();
  }

  return (
    <>
      <div className="space-y-3">
        {items.length === 0 ? (
          <Card className="p-6 flex flex-col items-center gap-2">
            <Trophy size={28} className="text-warning" />
            <p className="text-caption text-center">
              まだ大会・記録会の結果がありません
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-separator">
            {items.map((pb) => (
              <div key={pb.id} className="p-3.5 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-headline flex items-center gap-1.5 flex-wrap">
                    {pb.event_name}
                    {pb.is_pb && (
                      <span className="text-[10px] font-bold text-warning border border-warning rounded px-1 leading-tight">
                        PB
                      </span>
                    )}
                    {pb.is_ub && (
                      <span className="text-[10px] font-bold text-accent border border-accent rounded px-1 leading-tight">
                        UB
                      </span>
                    )}
                  </p>
                  {(pb.meet_name || pb.recorded_on) && (
                    <p className="text-caption">
                      {[pb.meet_name, pb.recorded_on].filter(Boolean).join(" ・ ")}
                    </p>
                  )}
                </div>
                <span className="text-title tabular-nums">{pb.record}</span>
                <button
                  onClick={() => remove(pb.id)}
                  aria-label="削除"
                  className="text-muted active:text-danger"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </Card>
        )}

        <Button variant="outline" size="lg" onClick={() => setOpen(true)} className="gap-2">
          <Plus size={18} /> 結果を追加
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="大会・記録会の結果を追加">
          <PbForm
            userId={userId}
            onDone={(created) => {
              if (created) {
                setItems((arr) => [
                  created,
                  // 同種目の古い PB/UB バッジはローカル表示からも外す
                  ...arr.map((x) =>
                    x.event_name === created.event_name
                      ? {
                          ...x,
                          is_pb: created.is_pb ? false : x.is_pb,
                          is_ub: created.is_ub ? false : x.is_ub,
                        }
                      : x,
                  ),
                ]);
              }
              setOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

function PbForm({
  userId,
  onDone,
}: {
  userId: string;
  onDone: (created?: PbRecord) => void;
}) {
  const router = useRouter();
  const [eventName, setEventName] = useState("");
  const [record, setRecord] = useState("");
  const [meetName, setMeetName] = useState("");
  const [recordedOn, setRecordedOn] = useState("");
  const [isPb, setIsPb] = useState(true);
  const [isUb, setIsUb] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!eventName.trim() || !record.trim()) {
      setError("種目と記録を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    const name = eventName.trim();
    const supabase = createClient();

    // 同じ種目の既存 PB/UB の印を外す（最新の1件だけに付くように）
    if (isPb) {
      await supabase
        .from("pb_records")
        .update({ is_pb: false })
        .eq("user_id", userId)
        .eq("event_name", name)
        .eq("is_pb", true);
    }
    if (isUb) {
      await supabase
        .from("pb_records")
        .update({ is_ub: false })
        .eq("user_id", userId)
        .eq("event_name", name)
        .eq("is_ub", true);
    }

    const { data, error } = await supabase
      .from("pb_records")
      .insert({
        user_id: userId,
        event_name: name,
        record: record.trim(),
        meet_name: meetName.trim() || null,
        recorded_on: recordedOn || null,
        is_pb: isPb,
        is_ub: isUb,
      })
      .select()
      .single();

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
        <Input placeholder="例: 5000m / 走幅跳 / 砲丸投" value={eventName} onChange={(e) => setEventName(e.target.value)} />
      </div>
      <div>
        <p className="section-label mb-1.5">記録</p>
        <Input placeholder={`例: 15'32"4 / 6m85 / 14m20`} value={record} onChange={(e) => setRecord(e.target.value)} />
      </div>
      <div>
        <p className="section-label mb-1.5">大会名（任意）</p>
        <Input value={meetName} onChange={(e) => setMeetName(e.target.value)} />
      </div>
      <div>
        <p className="section-label mb-1.5">記録日（任意）</p>
        <Input type="date" value={recordedOn} onChange={(e) => setRecordedOn(e.target.value)} />
      </div>
      <button
        type="button"
        onClick={() => setIsPb((v) => !v)}
        className="w-full flex items-center justify-between rounded-xl bg-card border border-separator p-3.5 active:bg-bg"
      >
        <span className="text-[14px]">PB（自己ベスト）として記録</span>
        <span
          className="h-6 w-10 rounded-full p-0.5 transition-colors flex"
          style={{ backgroundColor: isPb ? "#34c759" : "#e5e5ea", justifyContent: isPb ? "flex-end" : "flex-start" }}
        >
          <span className="h-5 w-5 rounded-full bg-white shadow" />
        </span>
      </button>
      <button
        type="button"
        onClick={() => setIsUb((v) => !v)}
        className="w-full flex items-center justify-between rounded-xl bg-card border border-separator p-3.5 active:bg-bg"
      >
        <span className="text-[14px]">UB として記録</span>
        <span
          className="h-6 w-10 rounded-full p-0.5 transition-colors flex"
          style={{ backgroundColor: isUb ? "#34c759" : "#e5e5ea", justifyContent: isUb ? "flex-end" : "flex-start" }}
        >
          <span className="h-5 w-5 rounded-full bg-white shadow" />
        </span>
      </button>
      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <Button size="lg" onClick={submit} disabled={saving}>
        {saving ? "保存中…" : "追加する"}
      </Button>
    </div>
  );
}
