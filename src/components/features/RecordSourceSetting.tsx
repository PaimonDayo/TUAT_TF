"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Toggle } from "@/components/ui/toggle";

export const RECORD_SOURCE_COOKIE = "show-record-source";
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
      label="記録の保存元を表示"
      description="練習記録に「スプレッドシート」「アプリ」のどちらで入力されたかを表示します。"
      checked={showSource}
      onChange={toggle}
    />
  );
}
