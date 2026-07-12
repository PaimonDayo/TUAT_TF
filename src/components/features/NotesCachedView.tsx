"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NotesView } from "@/components/features/NotesView";
import { loadNotesPageData, type NotesPageData } from "@/app/(app)/notes/actions";
import type { NoteScope } from "@/types";

export function NotesCachedView({ initialData, mine, initialScope }: { initialData: NotesPageData; mine: boolean; initialScope?: NoteScope }) {
  const queryClient = useQueryClient();
  const queryKey = ["notes", initialData.currentUser.id];
  const { data } = useQuery({ queryKey, queryFn: loadNotesPageData, initialData, staleTime: 60_000, refetchOnMount: false });
  // initialDataは初回マウントでしか使われないため、編集後のrouter.refresh()や再訪で
  // サーバーが新しいデータを返しても、これが無いと古いキャッシュが表示され続ける
  // （2026-07-13 オーナー報告「ノートの編集が反映されない」の原因）。
  useEffect(() => {
    queryClient.setQueryData(queryKey, initialData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, queryClient]);
  return <NotesView {...data} mine={mine} initialScope={initialScope} />;
}
