"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Toggle } from "@/components/ui/toggle";
import { RECORD_SOURCE_COOKIE } from "@/lib/record-source-display";

const ONE_YEAR = 31_536_000;

export function RecordSourceSetting({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [showSource, setShowSource] = useState(initial);

  function toggle() {
    const next = !showSource;
    setShowSource(next);
    document.cookie = [
      RECORD_SOURCE_COOKIE + "=" + (next ? "1" : "0"),
      "path=/",
      "max-age=" + ONE_YEAR,
      "samesite=lax",
    ].join(";");
    router.refresh();
  }

  return (
    <Toggle
      variant="row"
      label="投稿の保存元を表示"
      description="タイムラインの各投稿に「スプレッドシート由来」「アプリ由来」のどちらかを表示します。システム管理者にだけ見えます。"
      checked={showSource}
      onChange={toggle}
    />
  );
}
