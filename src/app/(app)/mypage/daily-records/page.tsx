import { redirect } from "next/navigation";
import { SubHeader } from "@/components/layout/SubHeader";
import { DailyRecordsView } from "@/components/features/DailyRecordsView";
import { getCurrentProfile } from "@/lib/supabase/auth";
import { permissionsOf } from "@/lib/permissions";
import { getDailyRecords } from "@/lib/queries";
import { jstToday } from "@/lib/date";

/** システムロール向け: 1日ごとに全員の練習記録をまとめて見る */
export default async function DailyRecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!permissionsOf(profile.roles).manageSystem) redirect("/mypage");
  const { date: requested } = await searchParams;
  const today = jstToday();
  const date = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) && requested <= today ? requested : today;
  const { records, missing } = await getDailyRecords(date);

  return (
    <>
      <SubHeader title="日別の記録" backHref="/mypage" />
      <DailyRecordsView date={date} today={today} records={records} missing={missing} />
    </>
  );
}
