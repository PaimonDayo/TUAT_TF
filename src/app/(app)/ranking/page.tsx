import { SubHeader } from "@/components/layout/SubHeader";
import { RankingList } from "@/components/features/RankingList";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getWeeklyRanking } from "@/lib/queries";
import { INTENSITY_ORDER, INTENSITY_LABELS } from "@/lib/constants";

export default async function RankingPage() {
  const profile = await getCurrentProfile();
  const rows = await getWeeklyRanking();

  return (
    <>
      <SubHeader title="ランキング" backHref="/home" backLabel="ホーム" />
      <div className="px-4 pb-3 space-y-2">
        <p className="text-body text-muted">直近7日間の走行距離 ・ 中長距離ブロック</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {INTENSITY_ORDER.map((k) => (
            <span key={k} className="flex items-center gap-1 text-[10px] text-muted2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: INTENSITY_LABELS[k].color }}
              />
              {INTENSITY_LABELS[k].label}
            </span>
          ))}
        </div>
      </div>
      <RankingList rows={rows} currentUserId={profile.id} />
    </>
  );
}
