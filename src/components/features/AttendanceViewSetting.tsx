"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { createClient } from "@/lib/supabase/client";
import type { AttendanceDefaultBlock } from "@/types";

const ITEMS: { key: AttendanceDefaultBlock; label: string }[] = [
  { key: "all", label: "全体" },
  { key: "middle_long", label: "中長距離" },
  { key: "short", label: "短距離" },
];

export function AttendanceViewSetting({
  userId,
  initial,
}: {
  userId: string;
  initial: AttendanceDefaultBlock;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [selected, setSelected] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function select(next: AttendanceDefaultBlock) {
    if (busy || next === selected) return;
    const previous = selected;
    setSelected(next);
    setBusy(true);
    const result = await safeUpdate(
      createClient(),
      "profiles",
      {
        attendance_default_block: next,
        // 旧クライアントとの互換用。新しい画面では attendance_default_block を参照する。
        attendance_view_all_blocks: next === "all",
      },
      { id: userId },
    );
    setBusy(false);
    if (!result.ok) {
      setSelected(previous);
      showToast(safeUpdateMessage(result.reason));
      return;
    }
    router.refresh();
  }

  return (
    <div className="px-4 py-3">
      <p className="text-[14px] font-medium">出欠一覧の初期表示</p>
      <p className="mb-2.5 mt-0.5 text-micro text-muted">
        出欠一覧と、ホーム・予定に出る出欠人数の対象ブロックです。
      </p>
      <SegmentedControl
        items={ITEMS}
        value={selected}
        onChange={select}
        className={busy ? "pointer-events-none opacity-60" : undefined}
      />
    </div>
  );
}
