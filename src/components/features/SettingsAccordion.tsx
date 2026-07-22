"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Settings, ChevronRight } from "lucide-react";
import { NotificationSettings } from "@/components/features/NotificationSettings";
import { MenuViewSetting } from "@/components/features/MenuViewSetting";
import { AttendanceViewSetting } from "@/components/features/AttendanceViewSetting";
import { SplashIntroSetting } from "@/components/features/SplashIntroSetting";
import { SystemSyncStatus } from "@/components/features/SystemSyncStatus";
import type { RecordFieldDef } from "@/types";

const RecordFieldsSetting = dynamic(
  () =>
    import("@/components/features/RecordFieldsSetting").then(
      (module) => module.RecordFieldsSetting,
    ),
  { loading: () => <div className="h-16 animate-pulse rounded-xl bg-separator/60" /> },
);

/**
 * マイページの「設定」行。押すと展開（details）して、通知・メニュー表示・記録項目をまとめて編集できる。
 * 全画面モーダルではなくその場で展開するタイプ（項目数が少ないため）。
 */
export function SettingsAccordion({
  profileId,
  initialComment,
  initialNotice,
  menuViewAll,
  attendanceViewAll,
  recordFields,
  isMiddleLong,
  canManageSystem,
}: {
  profileId: string;
  initialComment: boolean;
  initialNotice: boolean;
  menuViewAll: boolean;
  attendanceViewAll: boolean;
  recordFields: RecordFieldDef[];
  isMiddleLong: boolean;
  canManageSystem: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="group"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 active:bg-bg">
        <Settings size={20} className="text-muted2" />
        <span className="flex-1 text-headline">設定</span>
        <ChevronRight
          size={18}
          className="text-muted transition-transform group-open:rotate-90"
        />
      </summary>
      {open && <div className="space-y-6 border-t border-separator/70 bg-bg/40 p-4">
        <div className="space-y-2">
          <p className="section-label">表示</p>
          <AttendanceViewSetting userId={profileId} initial={attendanceViewAll} />
          <SplashIntroSetting />
          <MenuViewSetting userId={profileId} initial={menuViewAll} />
        </div>
        <NotificationSettings
          profileId={profileId}
          initialComment={initialComment}
          initialNotice={initialNotice}
        />
        {canManageSystem && <SystemSyncStatus />}
        <RecordFieldsSetting
          profileId={profileId}
          initial={recordFields}
          isMiddleLong={isMiddleLong}
        />
      </div>}
    </details>
  );
}
