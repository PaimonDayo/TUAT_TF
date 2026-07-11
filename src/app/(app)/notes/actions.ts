"use server";

import { getCurrentProfile } from "@/lib/supabase/auth";
import { getNotesData } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import type { AuthorMini, NoteWithRelations } from "@/types";

export type NotesPageData = { currentUser: AuthorMini; notes: NoteWithRelations[]; isAdmin: boolean };

export async function loadNotesPageData(): Promise<NotesPageData> {
  const [profile, data] = await Promise.all([getCurrentProfile(), getNotesData()]);
  return {
    currentUser: { id: profile.id, display_name: profile.display_name, avatar_url: profile.avatar_url, blocks: profile.blocks, grade: profile.grade },
    notes: data.notes,
    isAdmin: permissionsOf(profile.roles).manageMembers,
  };
}
