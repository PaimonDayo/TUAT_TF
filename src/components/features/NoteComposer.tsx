"use client";

import { useEffect, useState } from "react";
import { NoteEditor } from "@/components/features/NoteEditor";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import type { AuthorMini, NoteScope } from "@/types";

export function NoteComposer({
  currentUser,
  isAdmin,
  initialScope = "shared",
  onDone,
}: {
  currentUser: AuthorMini;
  isAdmin: boolean;
  initialScope?: NoteScope;
  onDone: () => void;
}) {
  const [members, setMembers] = useState<AuthorMini[] | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void supabase
      .from("profiles")
      .select("id, display_name, avatar_url, blocks, grade")
      .eq("status", "active")
      .order("display_name", { ascending: true })
      .then((memberResult) => {
        if (!active) return;
        setMembers((memberResult.data ?? []) as AuthorMini[]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!members) {
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
      isAdmin={isAdmin}
      initialScope={initialScope}
      onDone={onDone}
    />
  );
}
