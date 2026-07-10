"use client";

import { useRef, useState } from "react";
import { Check, X, Minus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
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
};

/** 未回答→出席→欠席→未回答の既存1タップ操作。 */
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
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle(event: React.MouseEvent) {
    event.stopPropagation();
    if (busy) return;
    const next = NEXT[status];
    setStatus(next);
    setBusy(true);
    onChanged?.({ status: next, isLate: false, lateNote: null });
    const supabase = createClient();
    if (next === "none") {
      await supabase.from("attendances").delete().eq("schedule_id", scheduleId).eq("user_id", userId);
    } else {
      await supabase.from("attendances").upsert(
        { schedule_id: scheduleId, user_id: userId, status: next, is_late: false, late_note: null, updated_at: new Date().toISOString() },
        { onConflict: "schedule_id,user_id" },
      );
    }
    setBusy(false);
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
      {style.icon}{style.label}
    </button>
  );
}

/** 当日の出席者だけに表示する遅刻設定。共通Toggle/Inputを使い、ページ再取得は行わない。 */
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
  const [late, setLate] = useState(initialLate);
  const [note, setNote] = useState(initialNote ?? "");
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function persistNote(value: string) {
    const normalized = value.trim() || null;
    await createClient().from("attendances").update({ late_note: normalized, updated_at: new Date().toISOString() }).eq("schedule_id", scheduleId).eq("user_id", userId);
    onChanged?.({ status: "present", isLate: true, lateNote: normalized });
  }

  async function toggleLate() {
    if (busy) return;
    const next = !late;
    const nextNote = next ? note.trim() || null : null;
    setLate(next);
    if (!next) setNote("");
    setBusy(true);
    await createClient().from("attendances").update({ is_late: next, late_note: nextNote, updated_at: new Date().toISOString() }).eq("schedule_id", scheduleId).eq("user_id", userId);
    setBusy(false);
    onChanged?.({ status: "present", isLate: next, lateNote: nextNote });
  }

  function changeNote(value: string) {
    setNote(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persistNote(value), 700);
  }

  return (
    <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
      <Toggle label="遅刻" checked={late} onChange={toggleLate} disabled={busy} className="min-h-11 p-3" />
      {late && (
        <Input
          value={note}
          onChange={(event) => changeNote(event.target.value)}
          onBlur={() => {
            if (saveTimer.current) clearTimeout(saveTimer.current);
            void persistNote(note);
          }}
          maxLength={60}
          placeholder="連絡事項（任意）"
        />
      )}
    </div>
  );
}
