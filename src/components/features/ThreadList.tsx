"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronRight, MessagesSquare } from "lucide-react";
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
}: {
  threads: ThreadWithAuthor[];
  currentUserId: string;
  isAdmin: boolean;
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

  return (
    <div className="space-y-2">
      {threads.map((thread) => (
        <Link key={thread.id} href={`/notes/threads/${thread.id}`}>
          <Card className="p-4 active:bg-bg">
            <div className="flex items-start gap-3">
              <MessagesSquare size={20} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-headline">{thread.title}</p>
                <p className="mt-1 text-caption">
                  {thread.author.display_name}・{thread.posts?.length ?? 0}件の投稿・
                  {format(new Date(thread.updated_at), "M月d日", { locale: ja })}
                </p>
              </div>
              {thread.author_id === currentUserId || isAdmin ? (
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
export function ThreadComposer({ userId, onDone }: { userId: string; onDone: () => void }) {
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
      .insert({ title: trimmed.slice(0, 100), author_id: userId })
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
