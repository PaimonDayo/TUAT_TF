import Link from "next/link";
import { Trophy, ChevronRight, Shield, Bell, CalendarPlus, Users } from "lucide-react";
import { Header } from "@/components/layout/Header";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { RecordCard } from "@/components/cards/RecordCard";
import { TweetCard } from "@/components/cards/TweetCard";
import { WeeklyBarChart } from "@/components/features/WeeklyBarChart";
import { EditProfileButton, SignOutButton } from "@/components/features/MyPageActions";
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
  const [records, activity] = await Promise.all([
    getUserRecords(profile.id) as Promise<PracticeRecord[]>,
    getUserActivity(profile.id, profile.id),
  ]);

  const perms = permissionsOf(profile.roles);
  const showAdminMenu = perms.manageMembers || perms.createSchedule || perms.createNotice;

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
                    className="inline-flex items-center gap-0.5 text-micro text-accent bg-accent/10 rounded-full px-2 py-0.5"
                  >
                    <Shield size={10} /> {r.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>

        {/* 直近7日間グラフ */}
        <WeeklyBarChart records={records} />

        {/* リンク */}
        <div className="space-y-2">
          <LinkCard href="/mypage/pb" icon={<Trophy size={20} className="text-warning" />} label="大会・記録会の結果" />
        </div>

        {/* 管理メニュー（権限に応じて表示） */}
        {showAdminMenu && (
          <section className="space-y-2">
            <p className="section-label">管理メニュー</p>
            <div className="space-y-2">
              {perms.createSchedule && (
                <LinkCard href="/schedule?compose=1" icon={<CalendarPlus size={20} className="text-accent" />} label="練習予定を作成" />
              )}
              {perms.createNotice && (
                <LinkCard href="/notices?compose=1" icon={<Bell size={20} className="text-warning" />} label="お知らせを投稿" />
              )}
              {perms.manageMembers && (
                <LinkCard href="/admin" icon={<Users size={20} className="text-accent" />} label="部員・ロール管理" />
              )}
            </div>
          </section>
        )}

        {/* 自分の投稿（記録・つぶやき） */}
        <section className="space-y-2">
          <p className="section-label">これまでの投稿</p>
          {activity.length === 0 ? (
            <Card className="p-4">
              <p className="text-caption">まだ投稿がありません</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {activity.map((item) =>
                item.kind === "record" ? (
                  <RecordCard key={`r-${item.id}`} record={item} currentUserId={profile.id} />
                ) : (
                  <TweetCard key={`t-${item.id}`} tweet={item} currentUserId={profile.id} />
                ),
              )}
            </div>
          )}
        </section>

        <SignOutButton />
      </div>
    </>
  );
}

function LinkCard({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href}>
      <Card className="p-4 flex items-center gap-3 active:bg-bg">
        {icon}
        <span className="flex-1 text-headline">{label}</span>
        <ChevronRight size={18} className="text-muted" />
      </Card>
    </Link>
  );
}
