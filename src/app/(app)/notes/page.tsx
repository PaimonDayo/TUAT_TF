import { cookies } from "next/headers";
import { Header } from "@/components/layout/Header";
import { NotesCachedView } from "@/components/features/NotesCachedView";
import { loadNotesPageData } from "./actions";
import type { NotesTab } from "@/components/features/NotesView";

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const [{ mine }, data, cookieStore] = await Promise.all([searchParams, loadNotesPageData(), cookies()]);
  // 共有/個人タブの選択をSSRで復元（ノート詳細から戻ってもタブが初期化されない）
  const savedScope = cookieStore.get("tuat-notes-scope")?.value;
  const initialScope: NotesTab =
    savedScope === "personal" || savedScope === "threads" ? savedScope : "shared";
  return <><Header title="ノート" large /><NotesCachedView initialData={data} mine={mine === "1"} initialScope={initialScope} /></>;
}
