"use client";

import { useState } from "react";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
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
  const { showToast } = useToast();
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
      showToast(safeUpdateMessage(result.reason));
      return;
    }
    // router.refresh() はしない。メニューを表示する画面は開くたびサーバーで描画し直すため
    // 次に開いたときに反映される（設定画面自体は手元の状態で表示済み）。
  }

  return (
    <Toggle
      variant="row"
      label="他ブロックのメニューも見る"
      description="自分のブロック以外の練習メニューも表示します。"
      checked={on}
      onChange={toggle}
    />
  );
}
