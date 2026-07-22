"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Folder, Pin } from "lucide-react";
import { searchNoteArticles, type NoteArticleSearchResult } from "@/app/(app)/notes/actions";
import { Avatar } from "@/components/common/Avatar";
import { FolderRowActions } from "@/components/features/FolderRowActions";
import { ThreadList } from "@/components/features/ThreadList";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import type {
  AuthorMini,
  NoteScope,
  NoteWithRelations,
  ThreadWithAuthor,
} from "@/types";

export type NotesTab = NoteScope | "threads";

/** 共有/個人タブの選択を保持するcookie（タイムラインの簡易表示cookieと同じ方式でSSR復元） */
const SCOPE_COOKIE = "tuat-notes-scope";

export function NotesView({
  currentUser,
  notes,
  threads = [],
  isAdmin = false,
  mine = false,
  initialScope = "shared",
}: {
  currentUser: AuthorMini;
  notes: NoteWithRelations[];
  threads?: ThreadWithAuthor[];
  isAdmin?: boolean;
  mine?: boolean;
  initialScope?: NotesTab;
}) {
  const [scope, setScope] = useState<NotesTab>(initialScope);
  const [query, setQuery] = useState("");
  const [articleResults, setArticleResults] = useState<NoteArticleSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase("ja");

  function changeScope(next: NotesTab) {
    setScope(next);
    // ノート詳細から戻ってページが再レンダーされても選択タブが残るようにする
    document.cookie = `${SCOPE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }
  const visibleNotes = useMemo(
    () =>
      notes.filter((note) => {
        if (note.parent_id) return false; // サブフォルダは親フォルダ内でのみ表示
        if (mine && note.author_id !== currentUser.id) return false;
        if (note.scope !== scope) return false;
        if (!mine && note.status !== "published") return false;
        return true;
      }).sort((a, b) => Number(b.pinned) - Number(a.pinned)),
    [currentUser.id, mine, notes, scope],
  );

  const matchingFolders = useMemo(() => {
    if (!normalizedQuery) return [];
    return notes.filter((note) => {
      if (mine && note.author_id !== currentUser.id) return false;
      if (note.scope !== scope) return false;
      if (!mine && note.status !== "published") return false;
      return `${note.title}\n${note.description ?? ""}`
        .toLocaleLowerCase("ja")
        .includes(normalizedQuery);
    });
  }, [currentUser.id, mine, normalizedQuery, notes, scope]);

  const matchingArticles = useMemo(
    () =>
      articleResults.filter((article) => {
        const note = article.note;
        if (!note || note.scope !== scope) return false;
        if (mine && note.author_id !== currentUser.id) return false;
        if (!mine && note.status !== "published") return false;
        return true;
      }),
    [articleResults, currentUser.id, mine, scope],
  );

  useEffect(() => {
    if (!normalizedQuery) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      setSearchError(false);
      try {
        const results = await searchNoteArticles(normalizedQuery);
        if (!cancelled) setArticleResults(results);
      } catch {
        if (!cancelled) setSearchError(true);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [normalizedQuery]);

  return (
    <div className="space-y-4 px-4 pt-1">
      <div className="flex min-h-9 items-center">
        <SegmentedControl
          items={[
            { key: "shared", label: "共有" },
            { key: "personal", label: "個人作成" },
            { key: "threads", label: "スレッド" },
          ].filter(({ key }) => key !== "threads")}
          value={scope}
          onChange={(key) => changeScope(key as NotesTab)}
          className="w-full"
        />
      </div>
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={"\u30ce\u30fc\u30c8\u3068\u8a18\u4e8b\u3092\u691c\u7d22"}
        aria-label={"\u30ce\u30fc\u30c8\u3068\u8a18\u4e8b\u3092\u691c\u7d22"}
      />


      {normalizedQuery ? (
        <NoteSearchResults
          folders={matchingFolders}
          articles={matchingArticles}
          currentUser={currentUser}
          isAdmin={isAdmin}
          mine={mine}
          searching={searching}
          error={searchError}
        />
      ) : scope === "threads" ? (
        <ThreadList threads={threads} currentUserId={currentUser.id} isAdmin={isAdmin} />
      ) : (
        <NoteList
          notes={visibleNotes}
          currentUser={currentUser}
          isAdmin={isAdmin}
          showAuthor={!mine}
        />
      )}
    </div>
  );
}

export function NoteList({
  notes,
  currentUser,
  isAdmin = false,
  showAuthor = false,
}: {
  notes: NoteWithRelations[];
  currentUser: AuthorMini;
  isAdmin?: boolean;
  showAuthor?: boolean;
}) {
  const currentUserId = currentUser.id;
  if (notes.length === 0) {
    return (
      <EmptyState
        title="ノートフォルダがありません"
        description="フォルダを作成すると、その中へ記事を追加できます。"
      />
    );
  }

  return (
    <div className="space-y-2">
      {[...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned)).map((note) => (
        <Link key={note.id} href={`/notes/${note.id}`}>
          <Card className="p-4 active:bg-bg">
            <div className="flex items-start gap-3">
              <Folder size={20} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="min-w-0 flex-1 truncate text-headline">{note.title}</p>
                  {note.status === "draft" && <Badge>下書き</Badge>}
                </div>
                  {note.pinned && <Pin size={14} className="shrink-0 fill-accent text-accent" aria-label={"\u30d4\u30f3\u7559\u3081"} />}
                <p className="mt-1 text-caption">
                  {note.articles?.length ?? 0}件の記事
                </p>
                {note.description && (
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-caption">
                    {note.description}
                  </p>
                )}
                {showAuthor && (
                  <div className="mt-2 flex items-center gap-2">
                    <Avatar
                      name={note.author.display_name}
                      avatarUrl={note.author.avatar_url}
                      blocks={note.author.blocks}
                      size="sm"
                    />
                    <span className="text-micro">
                      {note.author.id === currentUserId
                        ? "自分"
                        : note.author.display_name}
                    </span>
                  </div>
                )}
              </div>
              {note.author_id === currentUserId || isAdmin ? (
                <div
                  className="-mr-2 -mt-1 shrink-0"
                  onClick={(event) => {
                    // 行全体がLinkのため、メニュー操作でフォルダへ遷移しない
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <FolderRowActions note={note} currentUser={currentUser} isAdmin={isAdmin} />
                </div>
              ) : (
                <ChevronRight size={18} className="mt-0.5 shrink-0 text-muted" />
              )}
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function NoteSearchResults({
  folders,
  articles,
  currentUser,
  isAdmin,
  mine,
  searching,
  error,
}: {
  folders: NoteWithRelations[];
  articles: NoteArticleSearchResult[];
  currentUser: AuthorMini;
  isAdmin: boolean;
  mine: boolean;
  searching: boolean;
  error: boolean;
}) {
  if (error) {
    return <EmptyState title={"\u691c\u7d22\u306b\u5931\u6557\u3057\u307e\u3057\u305f\u3002\u901a\u4fe1\u72b6\u614b\u3092\u78ba\u8a8d\u3057\u3066\u518d\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044"} />;
  }
  if (searching && folders.length === 0 && articles.length === 0) {
    return <p className="py-8 text-center text-caption">{"\u691c\u7d22\u4e2d..."}</p>;
  }
  if (folders.length === 0 && articles.length === 0) {
    return <EmptyState title={"\u4e00\u81f4\u3059\u308b\u30ce\u30fc\u30c8\u3084\u8a18\u4e8b\u306f\u3042\u308a\u307e\u305b\u3093"} />;
  }
  return (
    <div className="space-y-5">
      {folders.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-caption font-semibold">{"\u30ce\u30fc\u30c8"}</h2>
          <NoteList
            notes={folders}
            currentUser={currentUser}
            isAdmin={isAdmin}
            showAuthor={!mine}
          />
        </section>
      )}
      {articles.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-caption font-semibold">{"\u8a18\u4e8b"}</h2>
          <div className="space-y-2">
            {articles.map((article) => (
              <Link key={article.id} href={`/notes/${article.note_id}/articles/${article.id}`}>
                <Card className="p-4 active:bg-bg">
                  <p className="text-headline">{article.title}</p>
                  <p className="mt-1 text-caption">{article.note?.title}</p>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
