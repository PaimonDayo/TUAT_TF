"use client";

import { Settings, ChevronRight } from "lucide-react";
import { NotificationSettings } from "@/components/features/NotificationSettings";
import { MenuViewSetting } from "@/components/features/MenuViewSetting";
import { RecordFieldsSetting } from "@/components/features/RecordFieldsSetting";
import type { RecordFieldDef } from "@/types";

/**
 * マイページの「設定」行。押すと展開（details）して、通知・メニュー表示・記録項目をまとめて編集できる。
 * 全画面モーダルではなくその場で展開するタイプ（項目数が少ないため）。
 */
export function SettingsAccordion({
  profileId,
  initialComment,
  initialNotice,
  menuViewAll,
  recordFields,
  isMiddleLong,
}: {
  profileId: string;
  initialComment: boolean;
  initialNotice: boolean;
  menuViewAll: boolean;
  recordFields: RecordFieldDef[];
  isMiddleLong: boolean;
}) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 active:bg-bg">
        <Settings size={20} className="text-muted2" />
        <span className="flex-1 text-headline">設定</span>
        <ChevronRight
          size={18}
          className="text-muted transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="space-y-6 border-t border-separator/70 bg-bg/40 p-4">
        <NotificationSettings
          profileId={profileId}
          initialComment={initialComment}
          initialNotice={initialNotice}
        />
        <div className="space-y-2">
          <p className="section-label">メニュー表示</p>
          <MenuViewSetting userId={profileId} initial={menuViewAll} />
        </div>
        <RecordFieldsSetting
          profileId={profileId}
          initial={recordFields}
          isMiddleLong={isMiddleLong}
        />
      </div>
    </details>
  );
}
