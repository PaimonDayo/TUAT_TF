import { SubHeader } from "@/components/layout/SubHeader";
import { RankingList } from "@/components/features/RankingList";
import { RankingMonthNav } from "@/components/features/RankingMonthNav";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { getMonthlyRanking } from "@/lib/queries";
import { jstToday } from "@/lib/date";
import { INTENSITY_ORDER, INTENSITY_LABELS } from "@/lib/constants";

export default async function RankingPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const requestedMonth = (await searchParams).month;
  const currentMonth = jstToday().slice(0, 7);
  const month = requestedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : currentMonth;
  const [year, monthNumber] = month.split("-").map(Number);
  const periodStart = `${month}-01`;
  const periodEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const profile = await getCurrentProfile();
  const rows = await getMonthlyRanking(periodStart, periodEnd);

  return (
    <>
      <SubHeader title="走行距離ランキング" backHref="/mypage" />
      <div className="px-4 pb-3 space-y-2">
        <RankingMonthNav month={month} currentMonth={currentMonth} />
        <p className="text-body text-muted">中長距離ブロックの走行距離</p>
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
