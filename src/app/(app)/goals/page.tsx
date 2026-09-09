import Link from "next/link";
import { ChevronRight, History } from "lucide-react";
import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Linkify } from "@/components/common/Linkify";
import { GoalEditor } from "@/components/features/GoalEditor";
import { CompetitionGoalLink } from "@/components/features/CompetitionGoalLink";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getGoalHub } from "@/lib/queries";

/**
 * 目標のハブ（マイページ→目標）。
 * 自由入力の目標と、大会ごとの種目別の目標を1か所から辿れるようにする。
 * 大会ごとの入力・一覧そのものは /competitions/[id]/goals が担当する。
 */
export default async function GoalsPage() {
  const profile = await getCurrentProfile();
  const { upcoming, past, myGoalCounts } = await getGoalHub(profile.id);

  return (
    <>
      <SubHeader title="目標" backHref="/mypage" />
      <div className="space-y-5 px-4 pt-2 pb-6">
        <section className="space-y-2">
          <p className="section-label">自由入力の目標</p>
          <Card className="overflow-hidden">
            {profile.goal ? (
              <p className="whitespace-pre-wrap px-4 pt-4 text-body">
                <Linkify text={profile.goal} />
              </p>
            ) : (
              <p className="px-4 pt-4 text-caption">
                まだ目標はありません。プロフィールに表示されます。
              </p>
            )}
            <GoalEditor
              userId={profile.id}
              goal={profile.goal}
              label={profile.goal ? "目標を編集" : "目標を設定"}
            />
          </Card>
        </section>

        <section className="space-y-2">
          <p className="section-label">大会ごとの目標</p>
          {upcoming.length === 0 ? (
            <Card>
              <EmptyState title="これからの大会はまだありません" />
            </Card>
          ) : (
            <Card className="divide-y divide-separator/70 overflow-hidden">
              {upcoming.map((competition) => (
                <CompetitionGoalLink
                  key={competition.id}
                  competition={competition}
                  count={myGoalCounts.get(competition.id) ?? 0}
                />
              ))}
            </Card>
          )}
          <p className="text-micro px-1">
            大会を選ぶと、その大会の種目ごとに目標を入力できます。
          </p>
        </section>

        <section className="space-y-2">
          <p className="section-label">これまで</p>
          <Card className="overflow-hidden">
            <Link
              href="/goals/past"
              className="flex items-center gap-3 p-4 active:bg-bg"
            >
              <History size={20} className="text-muted2" />
              <span className="flex-1 text-headline">過去の目標</span>
              <span className="text-caption tabular-nums">{past.length}大会</span>
              <ChevronRight size={18} className="text-muted" />
            </Link>
          </Card>
        </section>
      </div>
    </>
  );
}
