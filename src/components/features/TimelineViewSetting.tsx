"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { createClient } from "@/lib/supabase/client";
import type { TimelineDefaultBlock } from "@/types";

const ITEMS: { key: TimelineDefaultBlock; label: string }[] = [
  { key: "all", label: "全体" },
  { key: "middle_long", label: "中長距離" },
  { key: "short", label: "短距離" },
];

export function TimelineViewSetting({
  userId,
  initial,
}: {
  userId: string;
  initial: TimelineDefaultBlock;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [selected, setSelected] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function select(next: TimelineDefaultBlock) {
    if (busy || next === selected) return;
    const previous = selected;
    setSelected(next);
    setBusy(true);
    const result = await safeUpdate(
      createClient(),
      "profiles",
      { timeline_default_block: next },
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
    <div className="rounded-xl bg-card px-3 py-3">
      <p className="text-body font-semibold text-ink">タイムラインの初期表示</p>
      <p className="mb-2.5 mt-0.5 text-micro text-muted">
        タイムラインを開いたときに最初に表示するタブ
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
