"use client";

import { RefreshStatus } from "@/components/ui/refresh-status";
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScheduleView } from "@/components/features/ScheduleView";
import type { SchedulePageData } from "@/lib/schedule-page-data";
import {
  applyMiddleLongMenuSnapshot,
} from "@/lib/middle-long-menu-data";
import { middleLongMenuQueryOptions } from "@/lib/client/middle-long-menus";


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
  const { data, isError, refetch } = useQuery({
    queryKey,
    queryFn: ({ signal }) => loadSchedulePageData(signal),
    initialData,
    // The route already fetched these data. Do not immediately repeat the DB work.
    staleTime: 60_000,
    refetchOnMount: false,
    retry: false,
  });
  // サーバーが新しいデータを返したらセッションキャッシュにも反映する
  // （initialDataは初回マウント時のみ有効。無いと予定の編集・出欠変更が古いまま見える）。
  const menuQuery = useQuery(middleLongMenuQueryOptions({
    userId: initialData.userId,
    schedules: data.schedules,
    initialData: data.middleLongMenuSnapshot ?? undefined,
    enabled: data.wantsSheetMenus,
  }));

  useEffect(() => {
    queryClient.setQueryData(queryKey, initialData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, queryClient]);
  const viewData = useMemo(() => {
    const { middleLongMenuSnapshot, ...rest } = data;
    const snapshot = menuQuery.data ?? middleLongMenuSnapshot;
    return {
      ...rest,
      schedules: snapshot ? applyMiddleLongMenuSnapshot(data.schedules, snapshot) : data.schedules,
    };
  }, [data, menuQuery.data]);

  // CSV is supplemental to the DB schedule. Refresh silently so the list never jumps.
  return <><RefreshStatus failed={isError} busy={false} retry={() => { void refetch(); }} /><ScheduleView {...viewData} openId={openId} /></>;
}
