"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { createClient } from "@/lib/supabase/client";

/**
 * 「他ブロックのメニューも見る」個人設定（マイページ「その他」内の行）。
 * 既定オフ。オンにした本人だけ全ブロックのメニューが見える（RLSで担保）。
 */
export function MenuViewSetting({
  userId,
  initial,
}: {
  userId: string;
  initial: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    const supabase = createClient();
    const result = await safeUpdate(
      supabase,
      "profiles",
      { menu_view_all_blocks: next },
      { id: userId },
    );
    setBusy(false);
    if (!result.ok) {
      setOn(!next);
      alert(safeUpdateMessage(result.reason));
      return;
    }
    // サーバー側のキャッシュを更新（戻ってきたときに状態が戻らない・メニュー表示も即反映）
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="flex w-full items-center gap-3 py-3 pl-12 pr-4 text-left active:bg-bg"
    >
      <span className="text-accent">
        <Eye size={18} />
      </span>
      <span className="flex-1 text-[14px] font-semibold">他ブロックのメニューも見る</span>
      <span
        className="ml-2 flex h-6 w-10 shrink-0 rounded-full p-0.5 transition-colors"
        style={{
          backgroundColor: on ? "#34c759" : "#e5e5ea",
          justifyContent: on ? "flex-end" : "flex-start",
        }}
      >
        <span className="h-5 w-5 rounded-full bg-white shadow" />
      </span>
    </button>
  );
}
