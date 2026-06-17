import { notFound } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { Avatar } from "@/components/common/Avatar";
import { BlockPills } from "@/components/common/BlockPill";
import { RecordCard } from "@/components/cards/RecordCard";
import { WeeklyBarChart } from "@/components/features/WeeklyBarChart";
import { getProfileById, getUserRecords, getPbRecords } from "@/lib/queries";
import { ROLES, gradeShort } from "@/lib/constants";
import type { PbRecord, PracticeRecord, Profile, RecordWithAuthor } from "@/types";

export default async function MemberPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = (await getProfileById(id)) as Profile | null;
  if (!profile) notFound();

  const [records, pbs] = await Promise.all([
    getUserRecords(id) as Promise<PracticeRecord[]>,
    getPbRecords(id) as Promise<PbRecord[]>,
  ]);

  const authorMini = {
    id: profile.id,
    display_name: profile.display_name,
    avatar_url: profile.avatar_url,
    blocks: profile.blocks,
    grade: profile.grade,
  };

  const pbList = pbs.filter((p) => p.is_pb);

  return (
    <>
      <SubHeader title={profile.display_name || "部員"} backHref="/ranking" />

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
              {profile.role !== "member" && (
                <span className="ml-2 text-accent">{ROLES[profile.role].label}</span>
              )}
            </p>
          </div>
        </Card>

        <WeeklyBarChart records={records} />

        {pbList.length > 0 && (
          <section className="space-y-2">
            <p className="section-label">自己ベスト</p>
            <Card className="divide-y divide-separator">
              {pbList.map((pb) => (
                <div key={pb.id} className="p-3 flex items-center justify-between">
                  <span className="text-[14px] font-semibold">{pb.event_name}</span>
                  <span className="text-headline tabular-nums">{pb.record}</span>
                </div>
              ))}
            </Card>
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
