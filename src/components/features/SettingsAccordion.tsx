"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Settings, ChevronRight, ExternalLink } from "lucide-react";
import { NotificationSettings } from "@/components/features/NotificationSettings";
import { MenuViewSetting } from "@/components/features/MenuViewSetting";
import { AttendanceViewSetting } from "@/components/features/AttendanceViewSetting";
import { SplashIntroSetting } from "@/components/features/SplashIntroSetting";
import { TimelineCompactSetting } from "@/components/features/TimelineCompactSetting";
import { RecordSourceSetting } from "@/components/features/RecordSourceSetting";
import { SystemSyncStatus } from "@/components/features/SystemSyncStatus";
import type { AttendanceDefaultBlock, RecordFieldDef } from "@/types";

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
  attendanceDefaultBlock,
  recordFields,
  timelineCompact,
  showRecordSource,
  isMiddleLong,
  canManageSystem,
}: {
  profileId: string;
  initialComment: boolean;
  initialNotice: boolean;
  menuViewAll: boolean;
  attendanceDefaultBlock: AttendanceDefaultBlock;
  recordFields: RecordFieldDef[];
  isMiddleLong: boolean;
  timelineCompact: boolean;
  showRecordSource: boolean;
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
          <AttendanceViewSetting userId={profileId} initial={attendanceDefaultBlock} />
          <SplashIntroSetting />
          <TimelineCompactSetting initial={timelineCompact} />
          <MenuViewSetting userId={profileId} initial={menuViewAll} />
        </div>
        <NotificationSettings
          profileId={profileId}
          initialComment={initialComment}
          initialNotice={initialNotice}
        />
        {canManageSystem && (
          <div className="space-y-2">
            <p className="section-label">{"\u30b7\u30b9\u30c6\u30e0"}</p>
            <RecordSourceSetting initial={showRecordSource} />
            <SystemSyncStatus />
            <a
              href="/api/legacy-access"
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-12 items-center gap-3 rounded-xl bg-card px-3 py-2 active:bg-separator/70"
            >
              <ExternalLink size={18} className="shrink-0 text-muted2" />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-semibold text-ink">
                  旧アプリを開く
                </span>
                <span className="block text-micro text-muted">
                  システム管理者専用
                </span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-muted" />
            </a>
          </div>
        )}
        <RecordFieldsSetting
          profileId={profileId}
          initial={recordFields}
          isMiddleLong={isMiddleLong}
        />
      </div>}
    </details>
  );
}
