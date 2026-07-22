"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { createClient } from "@/lib/supabase/client";

export function AttendanceViewSetting({ userId, initial }: { userId: string; initial: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    const result = await safeUpdate(
      createClient(),
      "profiles",
      { attendance_view_all_blocks: next },
      { id: userId },
    );
    setBusy(false);
    if (!result.ok) {
      setOn(!next);
      showToast(safeUpdateMessage(result.reason));
      return;
    }
    router.refresh();
  }

  return <Toggle label="他ブロックの出欠も表示" checked={on} onChange={toggle} />;
}
