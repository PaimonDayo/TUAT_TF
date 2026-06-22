"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Toggle } from "@/components/ui/toggle";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { createClient } from "@/lib/supabase/client";

/**
 * 「他ブロックのメニューも見る」個人設定。既定オフ。
 * オンにした本人だけ全ブロックのメニューが見える（RLSで担保）。誰でも利用できる。
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
    <Toggle
      label="他ブロックのメニューも見る"
      description="自分の所属ブロック以外の練習メニューも表示します"
      checked={on}
      onChange={toggle}
    />
  );
}
