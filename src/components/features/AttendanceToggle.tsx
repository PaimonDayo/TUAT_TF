"use client";

import { useState } from "react";
import { Check, X, Minus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { AttendanceStatusOrNone } from "@/types";

const NEXT: Record<AttendanceStatusOrNone, AttendanceStatusOrNone> = {
  none: "present",
  present: "absent",
  absent: "none",
};

const STYLE: Record<
  AttendanceStatusOrNone,
  { label: string; cls: string; icon: React.ReactNode }
> = {
  none: {
    label: "出欠を入力",
    cls: "bg-accent/10 text-accent border-accent border-dashed",
    icon: <Minus size={15} />,
  },
  present: { label: "出席", cls: "bg-success text-white border-success", icon: <Check size={15} /> },
  absent: { label: "欠席", cls: "bg-danger text-white border-danger", icon: <X size={15} /> },
};

export type AttendanceChange = {
  status: AttendanceStatusOrNone;
  isLate: boolean;
  lateNote: string | null;
};

/** 出欠トグル（未定→出席→欠席→未定）。タップで自分の出欠を更新 */
export function AttendanceToggle({
  scheduleId,
  userId,
  initial,
  initialLate = false,
  initialLateNote = null,
  isToday = false,
  onChanged,
}: {
  scheduleId: string;
  userId: string;
  initial: AttendanceStatusOrNone;
  initialLate?: boolean;
  initialLateNote?: string | null;
  isToday?: boolean;
  onChanged?: (change: AttendanceChange) => void;
}) {
  const [status, setStatus] = useState<AttendanceStatusOrNone>(initial);
  const [late, setLate] = useState(initialLate);
  const [lateNote, setLateNote] = useState(initialLateNote ?? "");
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    const next = NEXT[status];
    const nextLate = next === "present" ? late : false;
    const nextNote = nextLate ? lateNote.trim() || null : null;
    setStatus(next);
    if (next !== "present") {
      setLate(false);
      setLateNote("");
    }
    setBusy(true);
    onChanged?.({ status: next, isLate: nextLate, lateNote: nextNote });

    const supabase = createClient();
    if (next === "none") {
      await supabase.from("attendances").delete().eq("schedule_id", scheduleId).eq("user_id", userId);
    } else {
      await supabase
        .from("attendances")
        .upsert(
          {
            schedule_id: scheduleId,
            user_id: userId,
            status: next,
            is_late: nextLate,
            late_note: nextNote,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "schedule_id,user_id" },
        );
    }
    setBusy(false);
  }

  async function toggleLate(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy || status !== "present") return;
    const next = !late;
    const nextNote = next ? lateNote.trim() || null : null;
    setLate(next);
    if (!next) setLateNote("");
    setBusy(true);
    onChanged?.({ status, isLate: next, lateNote: nextNote });
    const supabase = createClient();
    await supabase
      .from("attendances")
      .update({ is_late: next, late_note: nextNote, updated_at: new Date().toISOString() })
      .eq("schedule_id", scheduleId)
      .eq("user_id", userId);
    setBusy(false);
  }

  async function saveLateNote() {
    if (!late || status !== "present") return;
    const note = lateNote.trim() || null;
    onChanged?.({ status, isLate: late, lateNote: note });
    const supabase = createClient();
    await supabase
      .from("attendances")
      .update({ late_note: note, updated_at: new Date().toISOString() })
      .eq("schedule_id", scheduleId)
      .eq("user_id", userId);
  }

  const s = STYLE[status];
  const showLate = isToday && status === "present";
  return (
    <div className="flex flex-col gap-1.5" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center gap-1.5">
        <button
          onClick={toggle}
          disabled={busy}
          className={cn(
            "inline-flex h-8 w-[104px] shrink-0 items-center justify-center gap-1 rounded-full border px-3 text-[13px] font-semibold transition-active active:scale-95 disabled:opacity-60",
            s.cls,
          )}
        >
          {s.icon}
          {s.label}
        </button>
        {showLate && (
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
        )}
      </div>
      {showLate && late && (
        <input
          value={lateNote}
          onChange={(event) => setLateNote(event.target.value)}
          onBlur={saveLateNote}
          maxLength={60}
          placeholder="連絡事項（任意）"
          className="h-8 w-[220px] max-w-full rounded-xl border border-warning/40 bg-warning/5 px-2.5 text-[13px] outline-none"
        />
      )}
    </div>
  );
}
