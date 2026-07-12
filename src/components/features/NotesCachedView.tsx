"use client";

import { useQuery } from "@tanstack/react-query";
import { NotesView } from "@/components/features/NotesView";
import { loadNotesPageData, type NotesPageData } from "@/app/(app)/notes/actions";
import type { NoteScope } from "@/types";

export function NotesCachedView({ initialData, mine, initialScope }: { initialData: NotesPageData; mine: boolean; initialScope?: NoteScope }) {
  const { data } = useQuery({ queryKey: ["notes", initialData.currentUser.id], queryFn: loadNotesPageData, initialData, staleTime: 60_000, refetchOnMount: false });
  return <NotesView {...data} mine={mine} initialScope={initialScope} />;
}
