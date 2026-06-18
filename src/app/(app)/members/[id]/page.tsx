import { notFound } from "next/navigation";
import { Target } from "lucide-react";
import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { RecordCard } from "@/components/cards/RecordCard";
import { ResultsList } from "@/components/features/ResultsList";
import { WeeklyBarChart } from "@/components/features/WeeklyBarChart";
import { FavoriteButton } from "@/components/features/FavoriteButton";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getProfileById, getUserRecords, getPbRecords, isFavorite } from "@/lib/queries";
import { gradeShort } from "@/lib/constants";
import type { PbRecord, PracticeRecord, Profile, RecordWithAuthor } from "@/types";

export default async function MemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = (await getProfileById(id)) as Profile | null;
  if (!profile) notFound();

  const viewer = await getCurrentProfile();
  const isSelf = viewer.id === id;

  const [records, pbs, favorited] = await Promise.all([
    getUserRecords(id) as Promise<PracticeRecord[]>,
    getPbRecords(id) as Promise<PbRecord[]>,
    isSelf ? Promise.resolve(false) : isFavorite(viewer.id, id),
  ]);

  const authorMini = {
    id: profile.id,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    blocks: profile.blocks,
    grade: profile.grade,
  };

  return (
    <>
      <SubHeader
        title={profile.display_name || "部員"}
        right={!isSelf ? <FavoriteButton targetId={id} initial={favorited} /> : undefined}
      />

      <div className="px-4 space-y-5 pt-1">
        <Card className="p-4 flex items-center gap-4">
          <Avatar name={profile.display_name || "?"} blocks={profile.blocks} avatarUrl={profile.avatar_url} size="lg" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-title truncate">{profile.display_name || "名無し"}</h2>
              <BlockPills blocks={profile.blocks} full />
            </div>
            <p className="text-caption mt-0.5">
              {gradeShort(profile.grade) ?? "学年未設定"}
              {profile.roles?.length > 0 && (
                <span className="ml-2 text-accent">
                  {profile.roles.map((r) => r.name).join("・")}
                </span>
              )}
            </p>
            {profile.goal && (
              <p className="text-caption mt-1 flex items-start gap-1">
                <Target size={12} className="text-accent mt-[2px] shrink-0" />
                <span className="text-ink whitespace-pre-wrap">{profile.goal}</span>
              </p>
            )}
          </div>
        </Card>

        <WeeklyBarChart records={records} />

        {pbs.length > 0 && (
          <section className="space-y-2">
            <p className="section-label">大会・記録会の結果</p>
            <ResultsList results={pbs} />
          </section>
        )}

        <section className="space-y-2">
          <p className="section-label">これまでの記録</p>
          {records.length === 0 ? (
            <Card className="p-4">
              <p className="text-caption">まだ記録がありません</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {records.map((r) => (
                <RecordCard key={r.id} record={{ ...r, author: authorMini } as RecordWithAuthor} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
