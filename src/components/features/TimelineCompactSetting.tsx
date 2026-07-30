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
      variant="row"
      label="タイムラインを簡略表示"
      description="投稿の詳細を閉じた状態で表示します。"
      checked={compact}
      onChange={toggle}
    />
  );
}
