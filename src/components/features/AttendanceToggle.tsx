"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Check, X, Minus, Loader2, CircleCheck, CloudRain } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { Toggle } from "@/components/ui/toggle";
import { Input } from "@/components/ui/input";
import type { AttendanceStatusOrNone } from "@/types";

const NEXT: Record<AttendanceStatusOrNone, AttendanceStatusOrNone> = {
  none: "present",
  present: "absent",
  absent: "none",
};

const STYLE: Record<AttendanceStatusOrNone, { label: string; cls: string; icon: React.ReactNode }> = {
  none: { label: "出欠を入力", cls: "bg-accent/10 text-accent border-accent border-dashed", icon: <Minus size={15} /> },
  present: { label: "出席", cls: "bg-success text-white border-success", icon: <Check size={15} /> },
  absent: { label: "欠席", cls: "bg-danger text-white border-danger", icon: <X size={15} /> },
};

export type AttendanceChange = {
  status: AttendanceStatusOrNone;
  isLate: boolean;
  lateNote: string | null;
  absenceNote: string | null;
};

export type LateAttendanceChange = {
  isLate: boolean;
  lateNote: string | null;
};

/** 未回答→出席→欠席→未回答の1タップ操作。失敗時は表示を戻してエラーを知らせる。 */
export function AttendanceToggle({
  scheduleId,
  userId,
  initial,
  refreshOnChange = false,
  onChanged,
}: {
  scheduleId: string;
  userId: string;
  initial: AttendanceStatusOrNone;
  refreshOnChange?: boolean;
  onChanged?: (change: AttendanceChange) => void;
}) {
  const { showToast } = useToast();
  const router = useRouter();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle(event: React.MouseEvent) {
    event.stopPropagation();
    if (busy) return;
    const prev = status;
    const next = NEXT[status];
    setStatus(next);
    setBusy(true);
    onChanged?.({ status: next, isLate: false, lateNote: null, absenceNote: null });
    const supabase = createClient();
    const result =
      next === "none"
        ? await supabase.from("attendances").delete().eq("schedule_id", scheduleId).eq("user_id", userId).select("id")
        : await supabase.from("attendances").upsert(
            { schedule_id: scheduleId, user_id: userId, status: next, is_late: false, late_note: null, absence_note: null, updated_at: new Date().toISOString() },
            { onConflict: "schedule_id,user_id" },
          ).select("status, is_late, late_note, absence_note").single();
    setBusy(false);
    if (result.error || (next !== "none" && !result.data)) {
      setStatus(prev);
      onChanged?.({ status: prev, isLate: false, lateNote: null, absenceNote: null });
      showToast("出欠を送信できませんでした", "error");
      return;
    }
    if (refreshOnChange) router.refresh();
  }

  const style = STYLE[status];
  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={cn(
        "inline-flex h-8 w-[116px] shrink-0 items-center justify-center gap-1 rounded-full border px-3 text-[13px] font-semibold transition-active active:opacity-[0.78] disabled:opacity-60",
        style.cls,
      )}
    >
      {style.icon}
      {style.label}
    </button>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

/** 当日の出席者だけに表示する遅刻設定。出欠チップと同じ見た目に揃え、送信状況を必ず表示する。 */
export function LateAttendanceControl({
  scheduleId,
  userId,
  initialLate,
  initialNote,
  onChanged,
}: {
  scheduleId: string;
  userId: string;
  initialLate: boolean;
  initialNote: string | null;
  onChanged?: (change: LateAttendanceChange) => void;
}) {
  const { showToast } = useToast();
  const [late, setLate] = useState(initialLate);
  const [note, setNote] = useState(initialNote ?? "");
  const [busy, setBusy] = useState(false);
  const [noteState, setNoteState] = useState<SaveState>(initialNote ? "saved" : "idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  async function persistNote(value: string) {
    const normalized = value.trim() || null;
    setNoteState("saving");
    const { data, error } = await createClient()
      .from("attendances")
      .update({ late_note: normalized, updated_at: new Date().toISOString() })
      .eq("schedule_id", scheduleId)
      .eq("user_id", userId)
      .eq("status", "present")
      .eq("is_late", true)
      .select("is_late, late_note")
      .maybeSingle();
    if (error || !data) {
      setNoteState("error");
      showToast("連絡事項を送信できませんでした", "error");
      return;
    }
    setNoteState("saved");
    onChanged?.({ isLate: true, lateNote: normalized });
  }

  async function toggleLate() {
    if (busy) return;
    const prevLate = late;
    const prevNote = note;
    const next = !late;
    const nextNote = next ? note.trim() || null : null;
    setLate(next);
    if (!next) setNote("");
    setBusy(true);
    const { data, error } = await createClient()
      .from("attendances")
      .update({ is_late: next, late_note: nextNote, updated_at: new Date().toISOString() })
      .eq("schedule_id", scheduleId)
      .eq("user_id", userId)
      .eq("status", "present")
      .select("is_late, late_note")
      .maybeSingle();
    setBusy(false);
    if (error || !data) {
      setLate(prevLate);
      setNote(prevNote);
      showToast("遅刻の登録を送信できませんでした", "error");
      return;
    }
    setNoteState(nextNote ? "saved" : "idle");
    onChanged?.({ isLate: next, lateNote: nextNote });
  }

  function changeNote(value: string) {
    setNote(value);
    setNoteState("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void persistNote(value);
    }, 700);
  }

  function blurNote() {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    void persistNote(note);
  }

  return (
    <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
      <Toggle label="遅刻" checked={late} onChange={toggleLate} disabled={busy} className="min-h-11 p-3" />
      {late && (
        <div className="relative w-full">
          <Input
            value={note}
            onChange={(event) => changeNote(event.target.value)}
            onBlur={blurNote}
            maxLength={60}
            placeholder="連絡事項を入力（任意）"
            className={cn("w-full pr-10", noteState === "error" && "border-danger/50")}
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" aria-live="polite">
            {noteState === "saving" && <Loader2 size={17} className="animate-spin text-muted2" />}
            {noteState === "saved" && <CircleCheck size={18} className="text-success" />}
          </span>
        </div>
      )}
    </div>
  );
}


export function AbsenceAttendanceControl({ scheduleId, userId, initialNote, onChanged }: { scheduleId: string; userId: string; initialNote: string | null; onChanged?: (note: string | null) => void; }) {
  const { showToast } = useToast();
  const [note, setNote] = useState(initialNote ?? "");
  const [noteState, setNoteState] = useState<SaveState>(initialNote ? "saved" : "idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  async function persist(value: string) {
    const normalized = value.trim() || null; setNoteState("saving");
    const { data, error } = await createClient().from("attendances").update({ absence_note: normalized, updated_at: new Date().toISOString() }).eq("schedule_id", scheduleId).eq("user_id", userId).eq("status", "absent").select("absence_note").maybeSingle();
    if (error || !data) { setNoteState("error"); showToast("連絡事項を送信できませんでした", "error"); return; }
    setNoteState("saved"); onChanged?.(normalized);
  }
  function changeNote(value: string) { setNote(value); setNoteState("idle"); if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(() => { saveTimer.current = null; void persist(value); }, 700); }
  function blurNote() { if (!saveTimer.current) return; clearTimeout(saveTimer.current); saveTimer.current = null; void persist(note); }
  return <div className="relative w-full" onClick={(event) => event.stopPropagation()}><Input value={note} onChange={(event) => changeNote(event.target.value)} onBlur={blurNote} maxLength={60} placeholder={"\u6b20\u5e2d\u306e\u9023\u7d61\u4e8b\u9805\uff08\u4efb\u610f\uff09"} className={cn("w-full pr-10", noteState === "error" && "border-danger/50")} /><span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" aria-live="polite">{noteState === "saving" && <Loader2 size={17} className="animate-spin text-muted2" />}{noteState === "saved" && <CircleCheck size={18} className="text-success" />}</span></div>;
}

const WEATHER_PRESET = "雨天のため開催するか話し合い中です。決まり次第お知らせします。";

/** 雨天時など「話し合い中です」を伝える対応状況の閲覧用バナー（編集権限がない人向け） */
export function WeatherStatusBanner({ note, updatedAt }: { note: string; updatedAt: string | null }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2">
      <CloudRain size={16} className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium whitespace-pre-wrap">{note}</p>
        {updatedAt && (
          <p className="mt-0.5 text-micro text-muted2">{format(new Date(updatedAt), "M/d HH:mm", { locale: ja })} 更新</p>
        )}
      </div>
    </div>
  );
}

/** 雨天時など「開催を判断中です」を出欠欄の近くに表示・編集する（練習の開催判断権限を持つ人向け） */
export function WeatherStatusControl({
  scheduleId,
  initialNote,
  initialUpdatedAt,
  onChanged,
}: {
  scheduleId: string;
  initialNote: string | null;
  initialUpdatedAt: string | null;
  onChanged?: (note: string | null, updatedAt: string | null) => void;
}) {
  const { showToast } = useToast();
  const [note, setNote] = useState(initialNote ?? "");
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [saveState, setSaveState] = useState<SaveState>(initialNote ? "saved" : "idle");
  const [open, setOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  async function persist(value: string) {
    setSaveState("saving");
    const { data, error } = await createClient()
      .rpc("set_schedule_weather_note", { target_schedule_id: scheduleId, new_note: value || null });
    if (error || !data) {
      setSaveState("error");
      showToast("対応状況を送信できませんでした", "error");
      return;
    }
    setSaveState(data.weather_note ? "saved" : "idle");
    setUpdatedAt(data.weather_note_updated_at);
    onChanged?.(data.weather_note, data.weather_note_updated_at);
  }

  function changeNote(value: string) {
    setNote(value);
    setSaveState("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void persist(value); }, 700);
  }
  function blurNote() {
    if (!saveTimer.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    void persist(note);
  }
  function applyPreset() {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    setNote(WEATHER_PRESET);
    void persist(WEATHER_PRESET);
  }
  function clearNote() {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    setNote("");
    setOpen(false);
    void persist("");
  }

  // 予定ごとに入力欄を開いておくと場所を取るので、
  // 対応状況が無いあいだは小さな導線だけを出し、押したときに開く。
  if (!note && !open) {
    return (
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}
        className="flex items-center gap-1 text-[12px] text-muted2 active:opacity-60"
      >
        <CloudRain size={13} />
        対応状況を知らせる
      </button>
    );
  }

  return (
    <div className="space-y-1.5 rounded-xl border border-warning/40 bg-warning/10 p-3" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[12px] font-semibold text-warning"><CloudRain size={14} />対応状況（雨天時など）</p>
        <button type="button" onClick={note ? clearNote : () => setOpen(false)} className="text-[12px] text-muted2 active:opacity-60">
          {note ? "消す" : "閉じる"}
        </button>
      </div>
      <div className="relative w-full">
        <Input
          value={note}
          onChange={(event) => changeNote(event.target.value)}
          onBlur={blurNote}
          maxLength={80}
          placeholder="例: 開催するか話し合い中です"
          className="w-full pr-10"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" aria-live="polite">
          {saveState === "saving" && <Loader2 size={17} className="animate-spin text-muted2" />}
          {saveState === "saved" && <CircleCheck size={18} className="text-success" />}
        </span>
      </div>
      {!note && (
        <button type="button" onClick={applyPreset} className="text-[12px] font-medium text-accent active:opacity-60">
          「話し合い中です」と表示する
        </button>
      )}
      {updatedAt && <p className="text-micro text-muted2">{format(new Date(updatedAt), "M/d HH:mm", { locale: ja })} 更新</p>}
    </div>
  );
}
