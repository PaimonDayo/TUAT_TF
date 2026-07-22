"use server";

import { getCurrentProfile } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getNotesData, getThreads } from "@/lib/queries";
import { permissionsOf } from "@/lib/permissions";
import type { AuthorMini, NoteWithRelations, ThreadWithAuthor } from "@/types";

export type NotesPageData = { currentUser: AuthorMini; notes: NoteWithRelations[]; threads: ThreadWithAuthor[]; isAdmin: boolean };
export type NoteArticleSearchResult = {
  id: string;
  note_id: string;
  title: string;
  updated_at: string;
  note: {
    title: string;
    scope: string;
    status: string;
    author_id: string;
  } | null;
};


export async function loadNotesPageData(): Promise<NotesPageData> {
  const [profile, data, threads] = await Promise.all([getCurrentProfile(), getNotesData(), getThreads()]);
  return {
    currentUser: { id: profile.id, display_name: profile.display_name, avatar_url: profile.avatar_url, blocks: profile.blocks, grade: profile.grade },
    notes: data.notes,
    threads,
    isAdmin: permissionsOf(profile.roles).manageMembers,
  };
}

/** Search article titles and bodies in the database without sending all bodies to the browser. */
export async function searchNoteArticles(rawQuery: string): Promise<NoteArticleSearchResult[]> {
  await getCurrentProfile();
  const query = rawQuery.trim().slice(0, 100);
  if (!query) return [];

  const escaped = query.replace(/[\\%_]/g, (character) => `\\${character}`);
  const pattern = `%${escaped}%`;
  const select = "id, note_id, title, updated_at, note:notes!note_id(title, scope, status, author_id)";
  const supabase = await createClient();
  const [titleResult, bodyResult] = await Promise.all([
    supabase.from("note_articles").select(select).ilike("title", pattern).limit(40),
    supabase.from("note_articles").select(select).ilike("body", pattern).limit(40),
  ]);
  const error = titleResult.error ?? bodyResult.error;
  if (error) throw new Error("Failed to search note articles");

  const rows: NoteArticleSearchResult[] = [
    ...(titleResult.data ?? []),
    ...(bodyResult.data ?? []),
  ].map((row) => ({
    ...row,
    note: row.note ?? null,
  }));
  return [...new Map(rows.map((row) => [row.id, row])).values()]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 50);
}
