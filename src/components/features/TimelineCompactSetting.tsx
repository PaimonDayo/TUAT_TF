"use client";

import { Toggle } from "@/components/ui/toggle";
import { useBooleanPreference } from "@/hooks/use-boolean-preference";

const COOKIE_NAME = "timeline-compact";

export function TimelineCompactSetting({ initial }: { initial: boolean }) {
  const [compact, setCompact] = useBooleanPreference(initial, COOKIE_NAME);

  function toggle() {
    setCompact((current) => !current);
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
