"use client";

import { useQuery } from "@tanstack/react-query";
import { ScheduleView } from "@/components/features/ScheduleView";
import type { SchedulePageData } from "@/lib/schedule-page-data";

async function loadSchedulePageData(signal: AbortSignal): Promise<SchedulePageData> {
  const response = await fetch("/api/schedule-page", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Failed to load schedule data");
  return response.json() as Promise<SchedulePageData>;
}

export function ScheduleCachedView({ initialData, openId }: { initialData: SchedulePageData; openId?: string }) {
  const { data } = useQuery({
    queryKey: ["schedule", initialData.userId],
    queryFn: ({ signal }) => loadSchedulePageData(signal),
    initialData,
    staleTime: 30_000,
    refetchOnMount: false,
    retry: false,
  });
  return <ScheduleView {...data} openId={openId} />;
}
