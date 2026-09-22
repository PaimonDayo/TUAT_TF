import { Header } from "@/components/layout/Header";
import { ScheduleCachedView } from "@/components/features/ScheduleCachedView";
import { getSchedulePageData } from "@/lib/schedule-page-data";
import { Suspense } from "react";
import { ScheduleSkeleton } from "@/components/ui/page-skeletons";

export default function SchedulePage(props: { searchParams: Promise<{ compose?: string; open?: string }> }) {
  return <><Header title="予定" large /><Suspense fallback={<ScheduleSkeleton withHeader={false} />}><ScheduleContent {...props} /></Suspense></>;
}

async function ScheduleContent({
  searchParams,
}: {
  searchParams: Promise<{ compose?: string; open?: string }>;
}) {
  const [{ open }, data] = await Promise.all([searchParams, getSchedulePageData()]);
  return (
    <>
      <ScheduleCachedView initialData={data} openId={open} />
    </>
  );
}
