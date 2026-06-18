"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { AttendanceStatus, AttendanceStatusOrNone } from "@/types";

/**
 * 出欠ボタン（出席 / 欠席 の2ボタン）。
 * - 出席を押すと出席、欠席を押すと欠席。
 * - 選択中のボタンをもう一度押すと未定（取り消し）。
 */
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
  onChanged?: (status: AttendanceStatusOrNone) => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<AttendanceStatusOrNone>(initial);
  const [busy, setBusy] = useState(false);

  async function choose(e: React.MouseEvent, target: AttendanceStatus) {
    e.stopPropagation();
    if (busy) return;
    // 選択中のものを再度押したら取り消し（未定）
    const next: AttendanceStatusOrNone = status === target ? "none" : target;
    setStatus(next);
    setBusy(true);
    onChanged?.(next);

    const supabase = createClient();
    if (next === "none") {
      await supabase.from("attendances").delete().eq("schedule_id", scheduleId).eq("user_id", userId);
    } else {
      await supabase
        .from("attendances")
        .upsert(
          { schedule_id: scheduleId, user_id: userId, status: next, updated_at: new Date().toISOString() },
          { onConflict: "schedule_id,user_id" },
        );
    }
    setBusy(false);
    if (refreshOnChange) router.refresh();
  }

  return (
    <div className="inline-flex items-center gap-1.5 shrink-0">
      <button
        onClick={(e) => choose(e, "present")}
        disabled={busy}
        className={cn(
          "inline-flex items-center justify-center gap-1 h-8 px-3.5 rounded-full border text-[13px] font-semibold transition-active active:scale-95",
          status === "present"
            ? "bg-success text-white border-success"
            : "bg-card text-muted2 border-separator",
        )}
      >
        <Check size={15} />
        出席
      </button>
      <button
        onClick={(e) => choose(e, "absent")}
        disabled={busy}
        className={cn(
          "inline-flex items-center justify-center gap-1 h-8 px-3.5 rounded-full border text-[13px] font-semibold transition-active active:scale-95",
          status === "absent"
            ? "bg-danger text-white border-danger"
            : "bg-card text-muted2 border-separator",
        )}
      >
        <X size={15} />
        欠席
      </button>
    </div>
  );
}
