import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { MonthlyResultsView } from "@/components/features/MonthlyResultsView";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { getCompetitionEvents, getMonthlyResults } from "@/lib/queries";
import { jstToday } from "@/lib/date";
import type { CompetitionEvent } from "@/lib/competition-goals";

/** システムロール向け: 月ごとに全員の大会・記録会の結果をまとめて見る */
export default async function MonthlyResultsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) redirect("/mypage");
  const { month: requested } = await searchParams;
  const current = jstToday().slice(0, 7);
  const month = requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested) && requested <= current ? requested : current;
  const [results, events] = await Promise.all([getMonthlyResults(month), getCompetitionEvents()]);

  return (
    <>
      <SubHeader title="月別の大会結果" backHref="/mypage" />
      <MonthlyResultsView month={month} current={current} results={results} events={events as CompetitionEvent[]} />
    </>
  );
}
