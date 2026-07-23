"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TrainingChart } from "@/components/features/TrainingChart";
import { loadMyTrainingRecords } from "@/app/(app)/mypage/actions";
import type { PracticeRecord } from "@/types";

export function MyTrainingChartCached({
  userId,
  initialRecords,
  showIntensitySummary = false,
}: {
  userId: string;
  initialRecords: PracticeRecord[];
  showIntensitySummary?: boolean;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["my-training-records", userId];
  const { data } = useQuery({
    queryKey,
    queryFn: loadMyTrainingRecords,
    initialData: initialRecords,
    staleTime: 60_000,
    refetchOnMount: false,
  });
  // サーバーが新しい記録を返したらセッションキャッシュにも反映する
  // （initialDataは初回マウント時のみ有効。無いと記録の追加・編集がグラフに出ない）。
  useEffect(() => {
    queryClient.setQueryData(queryKey, initialRecords);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRecords, queryClient]);
  return <TrainingChart records={data} showIntensitySummary={showIntensitySummary} />;
}
