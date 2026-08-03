"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Toggle } from "@/components/ui/toggle";
import { useToast } from "@/components/ui/toast";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { createClient } from "@/lib/supabase/client";

export function TimelinePostVisibilitySetting({
  userId,
  initial,
}: {
  userId: string;
  initial: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [visible, setVisible] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    const next = !visible;
    setVisible(next);
    setBusy(true);

    const result = await safeUpdate(
      createClient(),
      "profiles",
      { timeline_posts_visible: next },
      { id: userId },
    );

    setBusy(false);
    if (!result.ok) {
      setVisible(!next);
      showToast(safeUpdateMessage(result.reason));
      return;
    }

    await queryClient.invalidateQueries({ queryKey: ["timeline"] });
    router.refresh();
  }

  return (
    <Toggle
      variant="row"
      label={"\u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\u306b\u81ea\u5206\u306e\u6295\u7a3f\u3092\u8868\u793a\u3059\u308b"}
      description={"\u30aa\u30d5\u306b\u3059\u308b\u3068\u3001\u7df4\u7fd2\u8a18\u9332\u3068\u3064\u3076\u3084\u304d\u3092\u30db\u30fc\u30e0\u30fb\u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\u306e\u4e00\u89a7\u306b\u8868\u793a\u3057\u307e\u305b\u3093\u3002"}
      checked={visible}
      disabled={busy}
      onChange={toggle}
    />
  );
}
