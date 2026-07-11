import { Header } from "@/components/layout/Header";
import { NotesCachedView } from "@/components/features/NotesCachedView";
import { loadNotesPageData } from "./actions";

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const [{ mine }, data] = await Promise.all([searchParams, loadNotesPageData()]);
  return <><Header title="ノート" large /><NotesCachedView initialData={data} mine={mine === "1"} /></>;
}
