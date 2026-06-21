"use client";

import { useState } from "react";
import { Toggle } from "@/components/ui/toggle";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { createClient } from "@/lib/supabase/client";

export function NotificationSettings({
  profileId,
  initialComment,
  initialSchedule,
  initialNotice,
}: {
  profileId: string;
  initialComment: boolean;
  initialSchedule: boolean;
  initialNotice: boolean;
}) {
  const [comment, setComment] = useState(initialComment);
  const [schedule, setSchedule] = useState(initialSchedule);
  const [notice, setNotice] = useState(initialNotice);
  const supabase = createClient();

  const handleChange = async (field: "notify_comment" | "notify_schedule" | "notify_notice", value: boolean, setter: (val: boolean) => void) => {
    setter(value);
    const result = await safeUpdate(supabase, "profiles", { [field]: value }, { id: profileId });
    if (!result.ok) {
      setter(!value);
      alert(safeUpdateMessage(result.reason));
    }
  };

  return (
    <div className="space-y-2">
      <p className="section-label">通知設定</p>
      <div className="space-y-1.5">
        <Toggle
          label="コメント通知"
          description="あなたの投稿にコメントがついたとき"
          checked={comment}
          onChange={() => handleChange("notify_comment", !comment, setComment)}
        />
        <Toggle
          label="予定の更新"
          description="新しい予定や変更があったとき"
          checked={schedule}
          onChange={() => handleChange("notify_schedule", !schedule, setSchedule)}
        />
        <Toggle
          label="お知らせ"
          description="新しいお知らせが投稿されたとき"
          checked={notice}
          onChange={() => handleChange("notify_notice", !notice, setNotice)}
        />
      </div>
    </div>
  );
}
