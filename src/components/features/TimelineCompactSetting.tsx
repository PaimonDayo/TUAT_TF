"use client";

import { useState } from "react";
import { Toggle } from "@/components/ui/toggle";

const COOKIE_NAME = "timeline-compact";
const ONE_YEAR = 31_536_000;

export function TimelineCompactSetting({ initial }: { initial: boolean }) {
  const [compact, setCompact] = useState(initial);

  function toggle() {
    const next = !compact;
    setCompact(next);
    document.cookie = [
      COOKIE_NAME + "=" + (next ? "1" : "0"),
      "path=/",
      "max-age=" + ONE_YEAR,
      "samesite=lax",
    ].join(";");
  }

  return (
    <Toggle
      label={"\u30bf\u30a4\u30e0\u30e9\u30a4\u30f3\u3092\u7c21\u7565\u8868\u793a"}
      description={"\u6295\u7a3f\u306e\u8a73\u7d30\u3092\u9589\u3058\u305f\u72b6\u614b\u3067\u8868\u793a\u3057\u307e\u3059"}
      checked={compact}
      onChange={toggle}
    />
  );
}
