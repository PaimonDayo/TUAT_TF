import { SubHeader } from "@/components/layout/SubHeader";
import { RankingList } from "@/components/features/RankingList";
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
        <p className="text-body text-muted">{`${year}年${monthNumber}月の走行距離 ・ 中長距離ブロック`}</p>
        <form className="flex items-center gap-2" action="/ranking">
          <label htmlFor="ranking-month" className="text-caption">集計月</label>
          <input
            id="ranking-month"
            name="month"
            type="month"
            defaultValue={month}
            max={currentMonth}
            className="h-10 rounded-xl border border-separator bg-card px-3 text-body"
          />
          <button className="h-10 rounded-xl bg-accent px-4 text-[14px] font-semibold text-white">表示</button>
        </form>
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
