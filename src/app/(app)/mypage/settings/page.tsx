import { cookies } from "next/headers";
import { ChevronRight, ExternalLink } from "lucide-react";
import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { AttendanceViewSetting } from "@/components/features/AttendanceViewSetting";
import { TimelineViewSetting } from "@/components/features/TimelineViewSetting";
import { MenuViewSetting } from "@/components/features/MenuViewSetting";
import { SplashIntroSetting } from "@/components/features/SplashIntroSetting";
import { NotificationSettings } from "@/components/features/NotificationSettings";
import { RecordFieldsSetting } from "@/components/features/RecordFieldsSetting";
import { SheetRecordFormSetting } from "@/components/features/SheetRecordFormSetting";
import { RecordSourceSetting } from "@/components/features/RecordSourceSetting";
import { SystemSyncStatus } from "@/components/features/SystemSyncStatus";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";

/**
 * 設定画面。マイページの中で展開する形だと項目が増えすぎて詰まって見えたため、
 * 独立したページに分けて「表示 / 通知 / 練習記録 / システム管理」へグループ分けした。
 * 行の見た目は1種類に統一し、上ほどよく触る項目を置いている。
 */
export default async function SettingsPage() {
  const profile = await getCurrentProfile();
  const cookieStore = await cookies();
  const showRecordSource = cookieStore.get("show-record-source")?.value === "1";
  const perms = permissionsOf(profile.roles);

  return (
    <>
      <SubHeader title="設定" backHref="/mypage" />

      <div className="space-y-5 px-4 pb-6 pt-1">
        <Section title="表示">
          <AttendanceViewSetting userId={profile.id} initial={profile.attendance_default_block} />
          <TimelineViewSetting userId={profile.id} initial={profile.timeline_default_block} />
          <MenuViewSetting userId={profile.id} initial={profile.menu_view_all_blocks ?? false} />
          <SplashIntroSetting />
        </Section>

        <Section title="通知">
          <NotificationSettings
            profileId={profile.id}
            initialComment={profile.notify_comment ?? true}
            initialNotice={profile.notify_notice ?? true}
          />
        </Section>

        <Section title="練習記録">
          {profile.sheet_name ? (
            <div>
              <SheetRecordFormSetting
                sheetName={profile.sheet_name}
                initial={profile.record_fields ?? []}
                isMiddleLong={profile.blocks.includes("middle_long")}
              />
            </div>
          ) : (
            <div>
              <RecordFieldsSetting
                profileId={profile.id}
                initial={profile.record_fields ?? []}
                isMiddleLong={profile.blocks.includes("middle_long")}
              />
            </div>
          )}
        </Section>

        {perms.manageSystem && (
          <section className="space-y-2">
            <p className="section-label">システム管理</p>
            <SystemSyncStatus />
            <Card className="divide-y divide-separator/70 overflow-hidden">
              <RecordSourceSetting initial={showRecordSource} />
              <a
                href="/api/legacy-access"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-3 active:bg-bg"
              >
                <ExternalLink size={19} className="shrink-0 text-muted2" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">旧アプリを開く</span>
                  <span className="block text-micro text-muted">システム管理者だけが開けます。</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-muted" />
              </a>
            </Card>
          </section>
        )}
      </div>
    </>
  );
}

/** 見出し＋区切り線つきカード。設定はすべてこの形で並べる。 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="section-label">{title}</p>
      <Card className="divide-y divide-separator/70 overflow-hidden">{children}</Card>
    </section>
  );
}
