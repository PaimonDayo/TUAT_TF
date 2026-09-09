import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CompetitionGoalLink } from "@/components/features/CompetitionGoalLink";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getGoalHub } from "@/lib/queries";

/** 過去の目標（終わった大会の一覧）。大会を選ぶとその大会の目標を見られる。 */
export default async function PastGoalsPage() {
  const profile = await getCurrentProfile();
  const { past, myGoalCounts } = await getGoalHub(profile.id);

  return (
    <>
      <SubHeader title="過去の目標" backHref="/goals" />
      <div className="space-y-2 px-4 pt-2 pb-6">
        {past.length === 0 ? (
          <Card>
            <EmptyState title="まだ終わった大会はありません" />
          </Card>
        ) : (
          <Card className="divide-y divide-separator/70 overflow-hidden">
            {past.map((competition) => (
              <CompetitionGoalLink
                key={competition.id}
                competition={competition}
                count={myGoalCounts.get(competition.id) ?? 0}
              />
            ))}
          </Card>
        )}
      </div>
    </>
  );
}
