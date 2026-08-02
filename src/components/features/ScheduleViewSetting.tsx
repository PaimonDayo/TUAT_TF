"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { createClient } from "@/lib/supabase/client";

export function ScheduleViewSetting({ userId, initial }: { userId: string; initial: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    const result = await safeUpdate(createClient(), "profiles", { schedule_view_all_blocks: next }, { id: userId });
    setBusy(false);
    if (!result.ok) {
      setOn(!next);
      showToast(safeUpdateMessage(result.reason));
      return;
    }
    router.refresh();
  }

  return <Toggle variant="row" label="他ブロックの予定も見る" description="中長距離・短距離の両方の予定を表示します。" checked={on} onChange={toggle} />;
}