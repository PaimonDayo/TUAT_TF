"use client";

import { useQuery } from "@tanstack/react-query";
import { ScheduleView } from "@/components/features/ScheduleView";
import { loadSchedulePageData } from "@/app/(app)/schedule/actions";
import type { SchedulePageData } from "@/lib/schedule-page-data";

export function ScheduleCachedView({ initialData, openId }: { initialData: SchedulePageData; openId?: string }) {
  const { data } = useQuery({
    queryKey: ["schedule", initialData.userId],
    queryFn: loadSchedulePageData,
    initialData,
    staleTime: 30_000,
    refetchOnMount: false,
  });
  return <ScheduleView {...data} openId={openId} />;
}
