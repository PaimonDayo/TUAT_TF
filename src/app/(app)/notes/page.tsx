import { cookies } from "next/headers";
import { Header } from "@/components/layout/Header";
import { NotesCachedView } from "@/components/features/NotesCachedView";
import { loadNotesPageData } from "./actions";
import type { NotesTab } from "@/components/features/NotesView";
import { Suspense } from "react";
import { NotesSkeleton } from "@/components/ui/page-skeletons";

export default function NotesPage(props: { searchParams: Promise<{ mine?: string }> }) {
  return <><Header title="ノート" large /><Suspense fallback={<NotesSkeleton withHeader={false} />}><NotesContent {...props} /></Suspense></>;
}

async function NotesContent({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const [{ mine }, data, cookieStore] = await Promise.all([searchParams, loadNotesPageData(), cookies()]);
  // 共有/個人タブの選択をSSRで復元（ノート詳細から戻ってもタブが初期化されない）
  const savedScope = cookieStore.get("tuat-notes-scope")?.value;
  const initialScope: NotesTab =
    savedScope === "personal" ? savedScope : "shared";
  return <NotesCachedView initialData={data} mine={mine === "1"} initialScope={initialScope} />;
}
