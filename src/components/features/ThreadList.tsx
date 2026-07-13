"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronRight, MessagesSquare, Pin } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { FormModalFooter } from "@/components/ui/form-modal";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import type { ThreadWithAuthor } from "@/types";

/** スレッド一覧（掲示板スタイル・タスク17-b） */
export function ThreadList({
  threads,
  currentUserId,
  isAdmin,
  canPin = false,
}: {
  threads: ThreadWithAuthor[];
  currentUserId: string;
  isAdmin: boolean;
  canPin?: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();

  if (threads.length === 0) {
    return (
      <EmptyState
        title="スレッドがありません"
        description="右下のボタンからスレッドを立てて、みんなで話せます。"
      />
    );
  }

  async function remove(id: string) {
    const { error } = await createClient().from("threads").delete().eq("id", id);
    if (error) {
      showToast("スレッドを削除できませんでした");
      return false;
    }
    router.refresh();
    return true;
  }

  async function togglePin(thread: ThreadWithAuthor) {
    const { error } = await createClient()
      .from("threads")
      .update({ pinned: !thread.pinned })
      .eq("id", thread.id);
    if (error) {
      showToast("\u30d4\u30f3\u7559\u3081\u3092\u5909\u66f4\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f");
      return;
    }
    router.refresh();
  }
  return (
    <div className="space-y-2">
      {[...threads].sort((a, b) => Number(b.pinned) - Number(a.pinned)).map((thread) => (
        <Link key={thread.id} href={`/notes/threads/${thread.id}`}>
          <Card className="p-4 active:bg-bg">
            <div className="flex items-start gap-3">
              <MessagesSquare size={20} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-headline">{thread.title}</p>
                <p className="mt-1 text-caption">
                {thread.pinned && <Pin size={14} className="mt-1 shrink-0 fill-accent text-accent" aria-label={"\u30d4\u30f3\u7559\u3081"} />}
                  {thread.author.display_name}・{thread.posts?.length ?? 0}件の投稿・
                  {format(new Date(thread.updated_at), "M月d日", { locale: ja })}
                </p>
              </div>
              {thread.author_id === currentUserId || isAdmin || canPin ? (
                <div
                  className="-mr-2 -mt-1 shrink-0"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <ActionMenu
                    onDelete={() => remove(thread.id)}
                    deleteTitle="スレッドを削除しますか？"
                    deleteDescription="スレッド内の投稿もすべて削除され、元に戻せません。"
                    onPin={canPin || thread.author_id === currentUserId ? () => togglePin(thread) : undefined}
                    pinned={thread.pinned}
                  />
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

/** スレッド作成フォーム（FABの「スレッド」から開く） */
export function ThreadComposer({ userId, folderId, onDone }: { userId: string; folderId: string; onDone: () => void }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const { data, error } = await createClient()
      .from("threads")
      .insert({ title: trimmed.slice(0, 100), author_id: userId, folder_id: folderId })
      .select("id")
      .single();
    setSaving(false);
    if (error || !data) {
      showToast("スレッドを作成できませんでした");
      return;
    }
    onDone();
    router.push(`/notes/threads/${data.id}`);
    router.refresh();
  }

  return (
    <div className="space-y-5 pb-4">
      <div>
        <p className="section-label mb-1.5">タイトル</p>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={100}
          placeholder="例: 合宿の持ち物どうする？"
        />
      </div>
      <p className="text-caption">スレッドは部員全員が見て返信できます。</p>
      <FormModalFooter>
        <Button type="button" className="w-full" disabled={!title.trim() || saving} onClick={create}>
          スレッドを立てる
        </Button>
      </FormModalFooter>
    </div>
  );
}
