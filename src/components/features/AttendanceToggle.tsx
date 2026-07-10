"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

/** 出欠トグル（未定→出席→欠席→未定）。タップで自分の出欠を更新 */
export function AttendanceToggle({
  scheduleId,
  userId,
  initial,
  initialLate = false,
  initialLateNote = null,
  isToday = false,
  refreshOnChange = false,
  onChanged,
}: {
  scheduleId: string;
  userId: string;
  initial: AttendanceStatusOrNone;
  initialLate?: boolean;
  initialLateNote?: string | null;
  isToday?: boolean;
  refreshOnChange?: boolean;
  onChanged?: (status: AttendanceStatusOrNone) => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<AttendanceStatusOrNone>(initial);
  const [late, setLate] = useState(initialLate);
  const [lateNote, setLateNote] = useState(initialLateNote ?? "");
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    const next = NEXT[status];
    setStatus(next);
    if (next !== "present") {
      setLate(false);
      setLateNote("");
    }
    setBusy(true);
    onChanged?.(next);

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
            is_late: next === "present" ? late : false,
            late_note: next === "present" && late ? lateNote.trim() || null : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "schedule_id,user_id" },
        );
    }
    setBusy(false);
    if (refreshOnChange) router.refresh();
  }

  async function toggleLate(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy || status !== "present") return;
    const next = !late;
    setLate(next);
    if (!next) setLateNote("");
    setBusy(true);
    const supabase = createClient();
    await supabase
      .from("attendances")
      .update({ is_late: next, late_note: next ? lateNote.trim() || null : null, updated_at: new Date().toISOString() })
      .eq("schedule_id", scheduleId)
      .eq("user_id", userId);
    setBusy(false);
    if (refreshOnChange) router.refresh();
  }

  async function saveLateNote() {
    if (!late || status !== "present") return;
    const supabase = createClient();
    await supabase
      .from("attendances")
      .update({ late_note: lateNote.trim() || null, updated_at: new Date().toISOString() })
      .eq("schedule_id", scheduleId)
      .eq("user_id", userId);
    if (refreshOnChange) router.refresh();
  }

  const s = STYLE[status];
  return (
    <div className="w-[116px] shrink-0" onClick={(event) => event.stopPropagation()}>
      <button
        onClick={toggle}
        disabled={busy}
        className={cn(
          "inline-flex h-8 w-[116px] items-center justify-center gap-1 rounded-full border px-3 text-[13px] font-semibold transition-active active:scale-95 disabled:opacity-60",
          s.cls,
        )}
      >
        {s.icon}
        {s.label}
      </button>
      {isToday && status === "present" && (
        <div className="mt-2">
          <button
            type="button"
            onClick={toggleLate}
            className="flex h-9 w-full items-center justify-between rounded-xl border border-separator bg-card px-2.5"
          >
            <span className="text-[13px] font-semibold">遅刻</span>
            <span className={cn("relative h-5 w-9 rounded-full transition-colors", late ? "bg-warning" : "bg-separator")}>
              <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform", late ? "translate-x-[18px]" : "translate-x-0.5")} />
            </span>
          </button>
          {late && (
            <input
              value={lateNote}
              onChange={(event) => setLateNote(event.target.value)}
              onBlur={saveLateNote}
              maxLength={60}
              placeholder="連絡事項（任意）"
              className="mt-1.5 h-9 w-full rounded-xl border border-warning/40 bg-warning/5 px-2.5 text-[13px] outline-none"
            />
          )}
        </div>
      )}
    </div>
  );
}
