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
      label="?????????????????"
      description="??????????????????????????????????????"
      checked={visible}
      disabled={busy}
      onChange={toggle}
    />
  );
}
