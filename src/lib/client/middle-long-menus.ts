import { queryOptions } from "@tanstack/react-query";
import { middleLongMenuMonths, type MiddleLongMenuSnapshot } from "@/lib/middle-long-menu-data";
import type { ScheduleWithMenus } from "@/types";

/** ホームと予定一覧で取得・鮮度・キャンセルの扱いを共通にする。 */
export function middleLongMenuQueryOptions({
  userId,
  schedules,
  enabled,
  initialData,
}: {
  userId: string | undefined;
  schedules: ScheduleWithMenus[];
  enabled: boolean;
  initialData?: MiddleLongMenuSnapshot;
}) {
  const months = middleLongMenuMonths(schedules);
  return queryOptions({
    queryKey: ["middle-long-menu-csv", userId, months.join(",")],
    queryFn: async ({ signal }): Promise<MiddleLongMenuSnapshot> => {
      const response = await fetch(`/api/middle-long-menus?months=${months.join(",")}`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) throw new Error("Failed to load middle-long menus");
      return response.json();
    },
    initialData,
    enabled: enabled && !!userId && months.length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
