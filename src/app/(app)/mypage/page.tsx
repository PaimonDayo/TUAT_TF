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
import { ROLES, gradeShort } from "@/lib/constants";
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

  const isStaff = profile.role === "admin" || profile.role === "menu_staff";
  const isAdmin = profile.role === "admin";

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
            <p className="text-caption mt-0.5">
              {gradeShort(profile.grade) ?? "学年未設定"}
              {profile.role !== "member" && (
                <span className="ml-2 inline-flex items-center gap-0.5 text-accent">
                  <Shield size={11} /> {ROLES[profile.role].label}
                </span>
              )}
            </p>
          </div>
        </Card>

        {/* 直近7日間グラフ */}
        <WeeklyBarChart records={records} />

        {/* リンク */}
        <div className="space-y-2">
          <LinkCard href="/mypage/pb" icon={<Trophy size={20} className="text-warning" />} label="大会・記録会の結果" />
        </div>

        {/* 管理者・担当者メニュー */}
        {isStaff && (
          <section className="space-y-2">
            <p className="section-label">{isAdmin ? "管理者メニュー" : "担当者メニュー"}</p>
            <div className="space-y-2">
              <LinkCard href="/schedule?compose=1" icon={<CalendarPlus size={20} className="text-accent" />} label="練習予定を作成" />
              {isAdmin && (
                <LinkCard href="/notices?compose=1" icon={<Bell size={20} className="text-warning" />} label="お知らせを投稿" />
              )}
              {isAdmin && (
                <LinkCard href="/admin" icon={<Users size={20} className="text-accent" />} label="部員管理（ロール変更）" />
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
