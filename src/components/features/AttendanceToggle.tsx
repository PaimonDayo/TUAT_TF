"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X, Minus, Loader2, CloudCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
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
};

/** 未回答→出席→欠席→未回答の1タップ操作。失敗時は表示を戻してエラーを知らせる。 */
export function AttendanceToggle({
  scheduleId,
  userId,
  initial,
  onChanged,
}: {
  scheduleId: string;
  userId: string;
  initial: AttendanceStatusOrNone;
  onChanged?: (change: AttendanceChange) => void;
}) {
  const { showToast } = useToast();
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle(event: React.MouseEvent) {
    event.stopPropagation();
    if (busy) return;
    const prev = status;
    const next = NEXT[status];
    setStatus(next);
    setBusy(true);
    onChanged?.({ status: next, isLate: false, lateNote: null });
    const supabase = createClient();
    const { error } =
      next === "none"
        ? await supabase.from("attendances").delete().eq("schedule_id", scheduleId).eq("user_id", userId)
        : await supabase.from("attendances").upsert(
            { schedule_id: scheduleId, user_id: userId, status: next, is_late: false, late_note: null, updated_at: new Date().toISOString() },
            { onConflict: "schedule_id,user_id" },
          );
    setBusy(false);
    if (error) {
      setStatus(prev);
      onChanged?.({ status: prev, isLate: false, lateNote: null });
      showToast("出欠を送信できませんでした。もう一度お試しください", "error");
    }
  }

  const style = STYLE[status];
  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={cn(
        "inline-flex h-8 w-[116px] shrink-0 items-center justify-center gap-1 rounded-full border px-3 text-[13px] font-semibold transition-active active:scale-95 disabled:opacity-60",
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
  onChanged?: (change: AttendanceChange) => void;
}) {
  const { showToast } = useToast();
  const [late, setLate] = useState(initialLate);
  const [note, setNote] = useState(initialNote ?? "");
  const [busy, setBusy] = useState(false);
  const [noteState, setNoteState] = useState<SaveState>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (savedResetTimer.current) clearTimeout(savedResetTimer.current);
    },
    [],
  );

  function flashSaved() {
    setNoteState("saved");
    if (savedResetTimer.current) clearTimeout(savedResetTimer.current);
    savedResetTimer.current = setTimeout(() => setNoteState("idle"), 1800);
  }

  async function persistNote(value: string) {
    const normalized = value.trim() || null;
    setNoteState("saving");
    const { error } = await createClient()
      .from("attendances")
      .update({ late_note: normalized, updated_at: new Date().toISOString() })
      .eq("schedule_id", scheduleId)
      .eq("user_id", userId);
    if (error) {
      setNoteState("error");
      showToast("連絡事項を送信できませんでした", "error");
      return;
    }
    flashSaved();
    onChanged?.({ status: "present", isLate: true, lateNote: normalized });
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
    const { error } = await createClient()
      .from("attendances")
      .update({ is_late: next, late_note: nextNote, updated_at: new Date().toISOString() })
      .eq("schedule_id", scheduleId)
      .eq("user_id", userId);
    setBusy(false);
    if (error) {
      setLate(prevLate);
      setNote(prevNote);
      showToast("遅刻の登録を送信できませんでした", "error");
      return;
    }
    onChanged?.({ status: "present", isLate: next, lateNote: nextNote });
  }

  function changeNote(value: string) {
    setNote(value);
    setNoteState("idle");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persistNote(value), 700);
  }

  function blurNote() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void persistNote(note);
  }

  return (
    <div className="flex flex-col items-start gap-1.5" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={toggleLate}
        disabled={busy}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[13px] font-semibold transition-active active:scale-95 disabled:opacity-60",
          late ? "border-warning/60 bg-warning/10 text-warning" : "border-separator bg-card text-muted2",
        )}
      >
        <span className={cn("relative h-4 w-7 shrink-0 rounded-full transition-colors", late ? "bg-warning" : "bg-separator")}>
          <span className={cn("absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform", late ? "translate-x-[14px]" : "translate-x-0.5")} />
        </span>
        遅刻
      </button>
      {late && (
        <div className="flex w-[240px] max-w-full items-center gap-1.5">
          <input
            value={note}
            onChange={(event) => changeNote(event.target.value)}
            onBlur={blurNote}
            maxLength={60}
            placeholder="連絡事項（任意）"
            className={cn(
              "h-8 min-w-0 flex-1 rounded-xl border bg-warning/5 px-2.5 text-[13px] outline-none",
              noteState === "error" ? "border-danger/50" : "border-warning/40",
            )}
          />
          <span className="w-4 shrink-0 text-muted2" aria-live="polite">
            {noteState === "saving" && <Loader2 size={15} className="animate-spin" />}
            {noteState === "saved" && <CloudCheck size={15} className="text-success" />}
          </span>
        </div>
      )}
    </div>
  );
}
