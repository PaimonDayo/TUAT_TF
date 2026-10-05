import { cookies } from "next/headers";
import { ChevronRight, ExternalLink, Activity, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { SettingsGroup } from "@/components/features/SettingsGroup";
import { AttendanceViewSetting } from "@/components/features/AttendanceViewSetting";
import { TimelineViewSetting } from "@/components/features/TimelineViewSetting";
import { MenuViewSetting } from "@/components/features/MenuViewSetting";
import { ScheduleViewSetting } from "@/components/features/ScheduleViewSetting";
import { SplashIntroSetting } from "@/components/features/SplashIntroSetting";
import { NotificationSettings } from "@/components/features/NotificationSettings";
import { RecordFieldsSetting } from "@/components/features/RecordFieldsSetting";
import { RecordSourceSetting } from "@/components/features/RecordSourceSetting";
import { SystemSyncStatus } from "@/components/features/SystemSyncStatus";
import { MemberPreviewSetting } from "@/components/features/MemberPreviewSetting";

import { EditProfileButton } from "@/components/features/MyPageActions";
import { SHEET_INPUT_MODE_LABELS } from "@/lib/sheet-input-mode";
import { SHEET_SETUP_PATH } from "@/lib/sheet-period";
import { getCurrentProfile, isMemberPreviewActive } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { RECORD_SOURCE_COOKIE, recordSourceEnabled } from "@/lib/record-source-display";

/**
 * 設定画面。マイページの中で展開する形だと項目が増えすぎて詰まって見えたため、
 * 独立したページに分けて「表示 / 通知 / 練習記録 / システム管理」へグループ分けした。
 * 行の見た目は1種類に統一し、上ほどよく触る項目を置いている。
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ profile?: string; setup?: string }> }) {
  const params = await searchParams;
  const profile = await getCurrentProfile();
  const previewingAsMember = await isMemberPreviewActive();
  const cookieStore = await cookies();
  const showRecordSource = recordSourceEnabled(cookieStore.get(RECORD_SOURCE_COOKIE)?.value);
  const perms = permissionsOf(profile.roles);

  return (
    <>
      <SubHeader title="設定" backHref="/mypage" />

      <div className="space-y-5 px-4 pb-6 pt-1">
        {/* プレビュー中は管理者向けが全部隠れるので、戻す導線を最初に出す */}
        {previewingAsMember && <MemberPreviewSetting previewing />}

        <Section title="プロフィール" collapsible defaultOpen={params.profile === "1" || params.setup === "1"}>
          <EditProfileButton profile={profile} settingsRow autoOpen={params.profile === "1" || params.setup === "1"} />
        </Section>

        <Section title="表示" collapsible>
          <AttendanceViewSetting userId={profile.id} initial={profile.attendance_default_block} />
          <TimelineViewSetting userId={profile.id} initial={profile.timeline_default_block} />
          <ScheduleViewSetting userId={profile.id} initial={profile.schedule_view_all_blocks ?? false} />
          <MenuViewSetting userId={profile.id} initial={profile.menu_view_all_blocks ?? false} />
          <SplashIntroSetting />
        </Section>

        <Section title="通知" collapsible>
          <NotificationSettings
            profileId={profile.id}
            initialComment={profile.notify_comment ?? true}
            initialNotice={profile.notify_notice ?? true}
            initialMention={profile.notify_mention ?? true}
          />
        </Section>

        <Section title="練習記録" id="practice-record-settings" collapsible>
          <Link data-ui-row href={SHEET_SETUP_PATH} prefetch={false} className="flex items-center gap-3 px-4 py-3 active:bg-bg">
              <SlidersHorizontal size={19} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">シート・入力方法・表示項目</span>
                <span className="block text-micro text-muted">{profile.sheet_transition ? `現在: ${SHEET_INPUT_MODE_LABELS[profile.sheet_transition.mode]}` : "10月以降の設定を確認してください"}</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-muted" />
          </Link>
          {profile.sheet_transition?.mode === "off" && <RecordFieldsSetting profileId={profile.id} initial={profile.record_fields} isMiddleLong={profile.blocks.includes("middle_long")} />}
        </Section>

        {perms.manageSystem && (
          <SettingsGroup title="システム管理">
            <div className="space-y-2 p-3">
            <SystemSyncStatus />
            <Card className="divide-y divide-separator/70 overflow-hidden">
              <Link data-ui-row href="/admin/services" prefetch={false} className="flex items-center gap-3 px-4 py-3 active:bg-bg">
                <Activity size={19} className="shrink-0 text-muted2" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium">サービスの状態</span>
                  <span className="block text-micro text-muted">Vercel・Supabase・Cloudflare</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-muted" />
              </Link>
              <RecordSourceSetting initial={showRecordSource} />
              <MemberPreviewSetting previewing={false} />
              <a
                data-ui-row
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
            </div>
          </SettingsGroup>
        )}
      </div>
    </>
  );
}

/** 見出し＋区切り線つきカード。設定はすべてこの形で並べる。 */
function Section({ title, children, id, collapsible = false, defaultOpen = false }: {
  title: string; children: React.ReactNode; id?: string; collapsible?: boolean; defaultOpen?: boolean;
}) {
  if (collapsible) {
    return <SettingsGroup title={title} id={id} defaultOpen={defaultOpen}>
      <div className="divide-y divide-separator/70">{children}</div>
    </SettingsGroup>;
  }
  return (
    <section id={id} className="scroll-mt-20 space-y-2">
      <p className="section-label">{title}</p>
      <Card className="divide-y divide-separator/70 overflow-hidden">{children}</Card>
    </section>
  );
}
