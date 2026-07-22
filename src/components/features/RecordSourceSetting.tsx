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
      label={"\u6295\u7a3f\u306e\u53d6\u5f97\u5143\u3092\u8868\u793a"}
      description={"\u7df4\u7fd2\u8a18\u9332\u306b\u300c\u30b9\u30d7\u30b7\u7531\u6765\u300d\u307e\u305f\u306f\u300c\u30a2\u30d7\u30ea\u7531\u6765\u300d\u3092\u8868\u793a\u3057\u307e\u3059"}
      checked={showSource}
      onChange={toggle}
    />
  );
}
