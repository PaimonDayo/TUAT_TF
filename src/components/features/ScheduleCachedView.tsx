"use client";

import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ScheduleView } from "@/components/features/ScheduleView";
import type { SchedulePageData } from "@/lib/schedule-page-data";
import {
  applyMiddleLongMenuSnapshot,
  middleLongMenuMonths,
  type MiddleLongMenuSnapshot,
} from "@/lib/middle-long-menu-data";


async function loadSchedulePageData(signal: AbortSignal): Promise<SchedulePageData> {
  const response = await fetch("/api/schedule-page", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Failed to load schedule data");
  return response.json() as Promise<SchedulePageData>;
}
async function loadMiddleLongMenus(months: number[], signal: AbortSignal): Promise<MiddleLongMenuSnapshot> {
  const response = await fetch(`/api/middle-long-menus?months=${months.join(",")}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error("Failed to load middle-long menus");
  return response.json() as Promise<MiddleLongMenuSnapshot>;
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
  const months = useMemo(() => middleLongMenuMonths(data.schedules), [data.schedules]);
  const menuQuery = useQuery({
    queryKey: ["middle-long-menu-csv", initialData.userId, months.join(",")],
    queryFn: ({ signal }) => loadMiddleLongMenus(months, signal),
    initialData: data.middleLongMenuSnapshot ?? undefined,
    enabled: data.middleLongMenuSnapshot !== null && months.length > 0,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: false,
  });

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

  return <ScheduleView {...viewData} openId={openId} />;
}
