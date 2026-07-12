"use server";

import { getCurrentProfile } from "@/lib/supabase/auth";
import { getNotesData, getThreads } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import type { AuthorMini, NoteWithRelations, ThreadWithAuthor } from "@/types";

export type NotesPageData = { currentUser: AuthorMini; notes: NoteWithRelations[]; threads: ThreadWithAuthor[]; isAdmin: boolean };

export async function loadNotesPageData(): Promise<NotesPageData> {
  const [profile, data, threads] = await Promise.all([getCurrentProfile(), getNotesData(), getThreads()]);
  return {
    currentUser: { id: profile.id, display_name: profile.display_name, avatar_url: profile.avatar_url, blocks: profile.blocks, grade: profile.grade },
    notes: data.notes,
    threads,
    isAdmin: permissionsOf(profile.roles).manageMembers,
  };
}
