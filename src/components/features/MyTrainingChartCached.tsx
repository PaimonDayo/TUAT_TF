"use client";

import { useQuery } from "@tanstack/react-query";
import { TrainingChart } from "@/components/features/TrainingChart";
import { loadMyTrainingRecords } from "@/app/(app)/mypage/actions";
import type { PracticeRecord } from "@/types";

export function MyTrainingChartCached({ userId, initialRecords }: { userId: string; initialRecords: PracticeRecord[] }) {
  const { data } = useQuery({
    queryKey: ["my-training-records", userId],
    queryFn: loadMyTrainingRecords,
    initialData: initialRecords,
    staleTime: 60_000,
    refetchOnMount: false,
  });
  return <TrainingChart records={data} />;
}
