// ノート（フォルダ・記事・スレッド）の取得。

import { createClient } from "@/lib/supabase/server";
import { normalizeNoteArticleRow, normalizeNoteRow, normalizeThreadPostRow, normalizeThreadRow } from "@/lib/query-normalize";
import type { ThreadPostWithAuthor, ThreadWithAuthor, NoteArticleWithAuthor, NotePollOption, NoteWithRelations } from "@/types";
import { isPresent } from "./internal";

const NOTE_SELECT = `
  *,
  author:profiles!author_id(id, display_name, avatar_url, blocks, grade),
  theme:note_themes(*),
  articles:note_articles(id),
  editors:note_editors(
    user_id,
    profile:profiles!user_id(id, display_name, avatar_url, blocks, grade)
  )
`;

/** RLSで閲覧可能なノートフォルダを取得 */
export async function getNotesData(): Promise<{
  notes: NoteWithRelations[];
}> {
  const supabase = await createClient();
  const { data: notes } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .order("updated_at", { ascending: false });
  return {
    notes: (notes ?? []).map(normalizeNoteRow).filter(isPresent),
  };
}

/** ノート詳細。RLSにより閲覧不可なら null */
export async function getNoteById(id: string): Promise<NoteWithRelations | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("id", id)
    .maybeSingle();
  return data ? normalizeNoteRow(data) : null;
}

/** スレッド一覧（新しいメッセージがあった順） */
export async function getThreads(): Promise<ThreadWithAuthor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("threads")
    .select(`*, author:profiles!author_id(id, display_name, avatar_url, blocks, grade), posts:thread_posts(id)`)
    .order("updated_at", { ascending: false });
  return (data ?? []).map(normalizeThreadRow);
}

/** Threads directly inside a note folder, newest activity first. */
export async function getThreadsByFolder(folderId: string): Promise<ThreadWithAuthor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("threads")
    .select(`*, author:profiles!author_id(id, display_name, avatar_url, blocks, grade), posts:thread_posts(id)`)
    .eq("folder_id", folderId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map(normalizeThreadRow);
}

/** スレッド詳細 */
export async function getThreadById(id: string): Promise<ThreadWithAuthor | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("threads")
    .select(`*, author:profiles!author_id(id, display_name, avatar_url, blocks, grade)`)
    .eq("id", id)
    .maybeSingle();
  return data ? normalizeThreadRow(data) : null;
}

/** スレッドの投稿（古い順=会話の流れ） */
export async function getThreadPosts(threadId: string): Promise<ThreadPostWithAuthor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("thread_posts")
    .select(`*, author:profiles!author_id(id, display_name, avatar_url, blocks, grade)`)
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  return (data ?? []).map(normalizeThreadPostRow);
}

/** フォルダ直下のサブフォルダ一覧（RLS継承） */
export async function getChildNotes(parentId: string): Promise<NoteWithRelations[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("parent_id", parentId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map(normalizeNoteRow).filter(isPresent);
}

/** パンくず用の祖先チェーン（ルート側から順）。深さ上限3のため最大2回辿る */
export async function getNoteAncestors(
  note: { parent_id: string | null },
): Promise<{ id: string; title: string }[]> {
  const supabase = await createClient();
  const chain: { id: string; title: string }[] = [];
  let parentId = note.parent_id;
  for (let i = 0; i < 2 && parentId; i++) {
    const { data } = await supabase
      .from("notes")
      .select("id, title, parent_id")
      .eq("id", parentId)
      .maybeSingle();
    if (!data) break;
    chain.unshift({ id: data.id as string, title: data.title as string });
    parentId = (data as { parent_id: string | null }).parent_id;
  }
  return chain;
}

/** フォルダ内の記事一覧。フォルダRLSを継承する */
export async function getNoteArticles(
  noteId: string,
): Promise<NoteArticleWithAuthor[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("note_articles")
    .select(`
      *,
      images:note_article_images(id,path),
      author:profiles!author_id(id, display_name, avatar_url, blocks, grade)
    `)
    .eq("note_id", noteId)
    .order("updated_at", { ascending: false });
  return attachNotePolls(supabase, (data ?? []).map(normalizeNoteArticleRow));
}

/**
 * 記事に投票の選択肢と集計を付ける。票そのものは本人の分しか読めないので、
 * 集計は閲覧可否を確かめる関数（get_note_poll_options）から受け取る。
 */
async function attachNotePolls(
  supabase: Awaited<ReturnType<typeof createClient>>,
  articles: NoteArticleWithAuthor[],
): Promise<NoteArticleWithAuthor[]> {
  const ids = articles.map((article) => article.id);
  if (ids.length === 0) return articles;
  const { data } = await supabase.rpc("get_note_poll_options", { article_ids: ids });
  const byArticle = new Map(
    (data ?? []).map((row) => [
      row.article_id,
      (Array.isArray(row.options) ? row.options : []) as unknown as NotePollOption[],
    ]),
  );
  return articles.map((article) => {
    const options = byArticle.get(article.id) ?? [];
    return options.length ? { ...article, pollOptions: options } : article;
  });
}

/** 記事詳細。親フォルダのRLSにより閲覧不可ならnull */
export async function getNoteArticleById(
  noteId: string,
  articleId: string,
): Promise<NoteArticleWithAuthor | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("note_articles")
    .select(`
      *,
      images:note_article_images(id,path),
      author:profiles!author_id(id, display_name, avatar_url, blocks, grade)
    `)
    .eq("note_id", noteId)
    .eq("id", articleId)
    .maybeSingle();
  if (!data) return null;
  const [article] = await attachNotePolls(supabase, [normalizeNoteArticleRow(data)]);
  return article;
}

/** ホームに表示する最近の共有ノート（RLSで閲覧可能なもの） */
export async function getRecentSharedNotes(
  limit = 3,
): Promise<NoteWithRelations[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("scope", "shared")
    .eq("status", "published")
    .order("updated_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map(normalizeNoteRow).filter(isPresent);
}

/** プロフィールに表示する公開個人ノート */
export async function getPublishedPersonalNotes(
  authorId: string,
): Promise<NoteWithRelations[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("author_id", authorId)
    .eq("scope", "personal")
    .eq("status", "published")
    .order("updated_at", { ascending: false });
  return (data ?? []).map(normalizeNoteRow).filter(isPresent);
}
