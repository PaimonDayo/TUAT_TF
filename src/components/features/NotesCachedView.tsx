"use client";

import { useQuery } from "@tanstack/react-query";
import { NotesView } from "@/components/features/NotesView";
import { loadNotesPageData, type NotesPageData } from "@/app/(app)/notes/actions";

export function NotesCachedView({ initialData, mine }: { initialData: NotesPageData; mine: boolean }) {
  const { data } = useQuery({ queryKey: ["notes", initialData.currentUser.id], queryFn: loadNotesPageData, initialData, staleTime: 60_000, refetchOnMount: false });
  return <NotesView {...data} mine={mine} />;
}
