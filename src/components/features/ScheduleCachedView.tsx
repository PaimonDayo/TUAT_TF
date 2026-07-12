"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  const queryClient = useQueryClient();
  const queryKey = ["schedule", initialData.userId];
  const { data } = useQuery({
    queryKey,
    queryFn: ({ signal }) => loadSchedulePageData(signal),
    initialData,
    staleTime: 30_000,
    refetchOnMount: false,
    retry: false,
  });
  // サーバーが新しいデータを返したらセッションキャッシュにも反映する
  // （initialDataは初回マウント時のみ有効。無いと予定の編集・出欠変更が古いまま見える）。
  useEffect(() => {
    queryClient.setQueryData(queryKey, initialData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, queryClient]);
  return <ScheduleView {...data} openId={openId} />;
}
