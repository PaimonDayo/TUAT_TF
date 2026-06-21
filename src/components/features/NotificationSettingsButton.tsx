"use client";

import { useState } from "react";
import { Bell, ChevronRight } from "lucide-react";
import { FormModal } from "@/components/ui/form-modal";
import { NotificationSettings } from "@/components/features/NotificationSettings";

/**
 * 通知設定をマイページのリスト（目標・メンバー一覧 等）と同じ並びに置くための行ボタン。
 * タップでシート（全画面フォーム）を開き、その中で通知設定を編集する。
 */
export function NotificationSettingsButton({
  profileId,
  initialComment,
  initialNotice,
}: {
  profileId: string;
  initialComment: boolean;
  initialNotice: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 p-4 text-left active:bg-bg"
      >
        <Bell size={20} className="text-accent" />
        <span className="flex-1 text-headline">通知設定</span>
        <ChevronRight size={18} className="text-muted" />
      </button>

      <FormModal open={open} onOpenChange={setOpen} title="通知設定" autoFocus={false}>
        <div className="pb-4">
          <NotificationSettings
            profileId={profileId}
            initialComment={initialComment}
            initialNotice={initialNotice}
          />
        </div>
      </FormModal>
    </>
  );
}
