"use client";

import { useMemo, useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScheduleCard } from "@/components/cards/ScheduleCard";
import { Skeleton } from "@/components/ui/skeleton";
import { middleLongMenuQueryOptions } from "@/lib/client/middle-long-menus";
import { applyMiddleLongMenuSnapshot, middleLongMenuMonths } from "@/lib/middle-long-menu-data";

/** 外部シートはホームの初期表示を待たせず、予定を開いたときだけ取得する。 */
export function HomeScheduleCard({ loadSheetMenus, ...props }: ComponentProps<typeof ScheduleCard> & { loadSheetMenus: boolean }) {
  const [open, setOpen] = useState(false);
  const canLoad = loadSheetMenus && !!props.userId && middleLongMenuMonths([props.schedule]).length > 0;
  const menus = useQuery(middleLongMenuQueryOptions({
    userId: props.userId,
    schedules: [props.schedule],
    enabled: canLoad && open,
  }));
  const schedule = useMemo(() => canLoad && menus.data
    ? applyMiddleLongMenuSnapshot([props.schedule], menus.data)[0]
    : props.schedule, [canLoad, menus.data, props.schedule]);
  const status = !canLoad ? null : menus.isPending ? (
    <div role="status" aria-label="練習メニューを読み込み中" className="space-y-2">
      <p className="section-label">練習メニュー</p>
      <Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" />
    </div>
  ) : menus.isError ? (
    <p className="text-caption">最新の練習メニューを読み込めませんでした。<button type="button" className="ml-1 text-accent" disabled={menus.isFetching} onClick={() => void menus.refetch()}>再読み込み</button></p>
  ) : !schedule.menus?.length ? <p className="text-caption">まだ練習メニューはありません</p> : null;

  return <ScheduleCard {...props} schedule={schedule} onOpenChange={setOpen} menuStatus={status} />;
}
