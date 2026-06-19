"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { NoteEditor } from "@/components/features/NoteEditor";
import { FolderForm } from "@/components/features/NotesView";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import type { AuthorMini, NoteTheme } from "@/types";

export function NoteComposer({
  currentUser,
  isAdmin,
  onDone,
}: {
  currentUser: AuthorMini;
  isAdmin: boolean;
  onDone: () => void;
}) {
  const [members, setMembers] = useState<AuthorMini[] | null>(null);
  const [folders, setFolders] = useState<NoteTheme[] | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, avatar_url, blocks, grade")
        .eq("status", "active")
        .order("display_name", { ascending: true }),
      supabase
        .from("note_themes")
        .select("*")
        .order("sort", { ascending: true })
        .order("created_at", { ascending: true }),
    ]).then(([memberResult, folderResult]) => {
      if (!active) return;
      setMembers((memberResult.data ?? []) as AuthorMini[]);
      setFolders((folderResult.data ?? []) as NoteTheme[]);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!members || !folders) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <NoteEditor
      currentUser={currentUser}
      members={members}
      themes={folders}
      isAdmin={isAdmin}
      initialScope="shared"
      onDone={onDone}
    />
  );
}

export function FolderComposer({
  userId,
  onDone,
}: {
  userId: string;
  onDone: () => void;
}) {
  const router = useRouter();
  return (
    <FolderForm
      currentUserId={userId}
      onDone={() => {
        router.refresh();
        onDone();
      }}
    />
  );
}
