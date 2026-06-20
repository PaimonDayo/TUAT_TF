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

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    const next = NEXT[status];
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

  const s = STYLE[status];
  return (
    <button
      onClick={toggle}
      className={cn(
        // 固定幅にして「出欠を入力/出席/欠席」で幅が変わらないようにする（ガクつき防止）
        "inline-flex items-center justify-center gap-1 h-8 px-3 w-[116px] rounded-full border text-[13px] font-semibold transition-active active:scale-95 shrink-0",
        s.cls,
      )}
    >
      {s.icon}
      {s.label}
    </button>
  );
}
