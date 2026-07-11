import { Header } from "@/components/layout/Header";
import { ScheduleCachedView } from "@/components/features/ScheduleCachedView";
import { getSchedulePageData } from "@/lib/schedule-page-data";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string; open?: string }>;
}) {
  const [{ open }, data] = await Promise.all([searchParams, getSchedulePageData()]);
  return (
    <>
      <Header title="予定" large />
      <ScheduleCachedView initialData={data} openId={open} />
    </>
  );
}
