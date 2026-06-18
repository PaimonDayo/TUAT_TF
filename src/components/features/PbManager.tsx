"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ResultsList } from "@/components/features/ResultsList";
import { cn } from "@/lib/utils";
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
        <ResultsList results={items} onDelete={remove} />

        <Button variant="outline" size="lg" onClick={() => setOpen(true)} className="gap-2">
          <Plus size={18} /> 結果を追加
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="大会・記録会の結果を追加">
          <PbForm
            userId={userId}
            onDone={(created) => {
              // PB/UB の最新判定は表示側(ResultsList)が記録日で行うため、追加するだけでよい
              if (created) setItems((arr) => [created, ...arr]);
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
  const [isOfficial, setIsOfficial] = useState(false);
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

    // PB/UB のバッジ表示は「種目ごと記録日が最新のもの」を表示時に判定するため、
    // ここでは入力された印をそのまま保存するだけでよい。
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
        is_official: isOfficial,
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
      <div>
        <p className="section-label mb-1.5">区分（複数選択可）</p>
        <div className="flex gap-2">
          <TagChip label="PB" active={isPb} onClick={() => setIsPb((v) => !v)} />
          <TagChip label="UB" active={isUb} onClick={() => setIsUb((v) => !v)} />
          <TagChip label="公認" active={isOfficial} onClick={() => setIsOfficial((v) => !v)} />
        </div>
      </div>
      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <Button size="lg" onClick={submit} disabled={saving}>
        {saving ? "保存中…" : "追加する"}
      </Button>
    </div>
  );
}

function TagChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 px-4 rounded-full border text-[14px] font-semibold inline-flex items-center gap-1 transition-active active:scale-95",
        active ? "bg-accent text-white border-accent" : "bg-card border-separator text-muted2",
      )}
    >
      {active && <Check size={15} />}
      {label}
    </button>
  );
}
