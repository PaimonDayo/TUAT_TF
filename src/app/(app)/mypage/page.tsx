import Link from "next/link";
import { Suspense } from "react";
import { Trophy, ChevronRight, Shield, Bell, CalendarPlus, Users, Target, MapPin, Settings } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { Linkify } from "@/components/common/Linkify";
import { ActivityFeed } from "@/components/features/ActivityFeed";
import { TrainingChart } from "@/components/features/TrainingChart";
import { EditProfileButton } from "@/components/features/MyPageActions";
import { SettingsAccordion } from "@/components/features/SettingsAccordion";
import { GoalEditor } from "@/components/features/GoalEditor";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getUserRecords, getUserActivity } from "@/lib/queries";
import { gradeShort } from "@/lib/constants";
import { permissionsOf } from "@/lib/permissions";
import type { PracticeRecord } from "@/types";

export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const { setup } = await searchParams;
  const profile = await getCurrentProfile();
  // グラフ用の記録だけ先に取得し、重い「これまでの投稿」は下で Suspense ストリーミング。
  const records = (await getUserRecords(profile.id)) as PracticeRecord[];

  const perms = permissionsOf(profile.roles);
  const showAdminMenu =
    perms.manageMembers || perms.createSchedule || perms.createNotice;

  return (
    <>
      <Header
        title="マイページ"
        large
        right={
          <EditProfileButton
            profile={{
              id: profile.id,
              display_name: profile.display_name,
              blocks: profile.blocks,
              events: profile.events,
              grade: profile.grade,
              avatar_url: profile.avatar_url,
            }}
            autoOpen={setup === "1"}
          />
        }
      />

      <div className="px-4 space-y-5 pt-1">
        {/* プロフィールカード */}
        <Card className="p-4 flex items-center gap-4">
          <Avatar
            name={profile.display_name || "?"}
            blocks={profile.blocks}
            avatarUrl={profile.avatar_url}
            size="lg"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-title truncate">{profile.display_name || "名前未設定"}</h2>
              <BlockPills blocks={profile.blocks} full />
            </div>
            <p className="text-caption mt-0.5">{gradeShort(profile.grade) ?? "学年未設定"}</p>
            {profile.roles.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {profile.roles.map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-0.5 text-micro rounded-full px-2 py-0.5"
                    style={{ color: r.color, backgroundColor: `${r.color}18` }}
                  >
                    <Shield size={10} /> {r.name}
                  </span>
                ))}
              </div>
            )}
            {profile.goal && (
              <p className="text-caption mt-1.5 flex items-start gap-1">
                <Target size={12} className="text-accent mt-[2px] shrink-0" />
                <span className="text-ink whitespace-pre-wrap">
                  <Linkify text={profile.goal} />
                </span>
              </p>
            )}
          </div>
        </Card>

        {/* 練習量の推移（日/週/月・横スライド） */}
        <TrainingChart records={records} />

        {/* リンク（1枚にまとめた区切り線リスト） */}
        <Card className="divide-y divide-separator/70 overflow-hidden">
          <GoalEditor userId={profile.id} goal={profile.goal} />
          <RowLink href="/mypage/pb" icon={<Trophy size={20} className="text-warning" />} label="大会・記録会の結果" />
          <RowLink href="/members" icon={<Users size={20} className="text-accent" />} label="メンバー一覧" />
          <RowLink href="/ranking" icon={<Trophy size={20} className="text-muted2" />} label="ランキング" />
          <SettingsAccordion
            profileId={profile.id}
            initialComment={profile.notify_comment ?? true}
            initialNotice={profile.notify_notice ?? true}
            menuViewAll={profile.menu_view_all_blocks ?? false}
          />
        </Card>

        {/* 管理メニュー（権限に応じて表示） */}
        {showAdminMenu && (
          <section className="space-y-2">
            <p className="section-label">管理メニュー</p>
            <Card className="divide-y divide-separator/70 overflow-hidden">
              {perms.createSchedule && (
                <RowLink href="/schedule?compose=1" icon={<CalendarPlus size={20} className="text-accent" />} label="予定を作成" />
              )}
              {perms.createNotice && (
                <RowLink href="/notices?compose=1" icon={<Bell size={20} className="text-warning" />} label="お知らせを作成" />
              )}
              {/* その他（めったに触らない設定はここに畳んでおく） */}
              {(perms.manageMembers || perms.createSchedule) && (
                <details>
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-4 active:bg-bg">
                    <Settings size={20} className="text-muted2" />
                    <span className="flex-1 text-headline">その他</span>
                    <ChevronRight size={18} className="text-muted" />
                  </summary>
                  <div className="divide-y divide-separator/70 border-t border-separator/70 bg-bg/40">
                    {perms.manageMembers && (
                      <RowSubLink href="/admin" icon={<Users size={18} />} label="ロール管理" />
                    )}
                    {perms.createSchedule && (
                      <RowSubLink href="/venues" icon={<MapPin size={18} />} label="練習場所" />
                    )}
                  </div>
                </details>
              )}
            </Card>
          </section>
        )}

        {/* 自分の投稿（記録・つぶやき）— 重いので後から流し込む */}
        <section className="space-y-2">
          <p className="section-label">これまでの投稿</p>
          <Suspense fallback={<ActivitySkeleton />}>
            <MyActivity
              userId={profile.id}
              currentUser={{
                id: profile.id,
                display_name: profile.display_name,
                avatar_url: profile.avatar_url,
              }}
            />
          </Suspense>
        </section>
      </div>
    </>
  );
}

/** 自分の投稿一覧（記録＋つぶやき）。Suspense で遅延読み込み */
async function MyActivity({
  userId,
  currentUser,
}: {
  userId: string;
  currentUser: import("@/types").CommentAuthor;
}) {
  const activity = await getUserActivity(userId, userId);
  if (activity.length === 0) {
    return <EmptyState title="まだ投稿がありません" className="min-h-24 py-4" />;
  }
  return <ActivityFeed activity={activity} currentUser={currentUser} />;
}

function ActivitySkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {[0, 1].map((i) => (
        <div key={i} className="rounded-[16px] bg-card border border-separator p-4 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="h-10 w-10 rounded-full bg-separator" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-28 rounded bg-separator" />
              <div className="h-2.5 w-20 rounded bg-bg" />
            </div>
          </div>
          <div className="h-2.5 w-full rounded-full bg-separator" />
        </div>
      ))}
    </div>
  );
}

/** 区切り線リスト内の1行リンク（カード枠は親のCardが持つ） */
function RowLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} prefetch className="flex items-center gap-3 p-4 active:bg-bg">
      {icon}
      <span className="flex-1 text-headline">{label}</span>
      <ChevronRight size={18} className="text-muted" />
    </Link>
  );
}

/** 「その他」内のサブ行リンク（少しインデント） */
function RowSubLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} prefetch className="flex items-center gap-3 py-3 pl-12 pr-4 active:bg-bg">
      <span className="text-accent">{icon}</span>
      <span className="flex-1 text-[14px] font-semibold">{label}</span>
      <ChevronRight size={16} className="text-muted" />
    </Link>
  );
}
