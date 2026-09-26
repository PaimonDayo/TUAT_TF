import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { MonthlyResultsView, type ResultsPeriod } from "@/components/features/MonthlyResultsView";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { getCompetitionEvents, getCompetitions, getLatestResults, getMonthlyResults, getYearlyResults } from "@/lib/queries";
import { jstToday } from "@/lib/date";
import type { CompetitionEvent } from "@/lib/competition-goals";

/** システムロール向け: 全員の大会・記録会の結果を、月別・年別・新しく登録された順で見る */
export default async function MonthlyResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; month?: string; year?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) redirect("/mypage");
  const params = await searchParams;
  const today = jstToday();
  const currentMonth = today.slice(0, 7);
  const currentYear = today.slice(0, 4);

  let period: ResultsPeriod;
  if (params.view === "latest") {
    period = { kind: "latest" };
  } else if (params.view === "year") {
    const year = params.year && /^\d{4}$/.test(params.year) && params.year <= currentYear ? params.year : currentYear;
    period = { kind: "year", value: year, current: currentYear };
  } else {
    const month = params.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) && params.month <= currentMonth ? params.month : currentMonth;
    period = { kind: "month", value: month, current: currentMonth };
  }
  const [results, events, competitions] = await Promise.all([
    period.kind === "latest" ? getLatestResults() : period.kind === "year" ? getYearlyResults(period.value) : getMonthlyResults(period.value),
    getCompetitionEvents(),
    getCompetitions(),
  ]);

  return (
    <>
      <SubHeader title="大会結果" backHref="/mypage" />
      <MonthlyResultsView
        key={period.kind === "latest" ? "latest" : `${period.kind}:${period.value}`}
        period={period}
        results={results}
        events={events as CompetitionEvent[]}
        competitions={competitions}
      />
    </>
  );
}
