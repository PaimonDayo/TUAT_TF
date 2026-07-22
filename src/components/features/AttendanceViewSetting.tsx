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

  return <Toggle label={"\u51fa\u6b20\u3092\u958b\u3044\u305f\u3068\u304d\u5168\u4f53\u3092\u8868\u793a"} checked={on} onChange={toggle} />;
}
