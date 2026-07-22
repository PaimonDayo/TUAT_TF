"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Send } from "lucide-react";
import { Avatar } from "@/components/common/Avatar";
import { Linkify } from "@/components/common/Linkify";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import type { AuthorMini, ThreadPostWithAuthor } from "@/types";

/** スレッドの投稿一覧＋返信欄（掲示板スタイル・時系列） */
export function ThreadPostsView({
  threadId,
  posts,
  currentUserId,
  isAdmin,
  currentUser,
}: {
  threadId: string;
  posts: ThreadPostWithAuthor[];
  currentUserId: string;
  isAdmin: boolean;
  currentUser: AuthorMini;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [visiblePosts, setVisiblePosts] = useState(posts);
  async function send() {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    const submittedBody = trimmed.slice(0, 2000);
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    setVisiblePosts((current) => [...current, {
      id: optimisticId, thread_id: threadId, author_id: currentUserId,
      body: submittedBody, created_at: now, updated_at: now, author: currentUser,
    }]);
    setBody("");

    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setSending(true);
    const { data, error } = await createClient()
      .from("thread_posts")
      .insert({ thread_id: threadId, author_id: currentUserId, body: submittedBody })
      .select("id, thread_id, author_id, body, created_at, updated_at")
      .single();
    setSending(false);
    if (error) {
      showToast("投稿できませんでした");
      setVisiblePosts((current) => current.filter((post) => post.id !== optimisticId));
      setBody(submittedBody);
      return;
    }
    setVisiblePosts((current) => current.map((post) => post.id === optimisticId ? { ...post, ...data } : post));
    router.refresh();
  }

  function resizeComposer(textarea: HTMLTextAreaElement) {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }

  async function removePost(id: string) {
    const { error } = await createClient().from("thread_posts").delete().eq("id", id);
    if (error) {
      showToast("投稿を削除できませんでした");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <div className="space-y-4 pb-20">
      {visiblePosts.length === 0 ? (
        <EmptyState title="まだ投稿がありません" description="最初のひとことを書いてみましょう。" />
      ) : (
        <div className="space-y-2">
          {visiblePosts.map((post) => (
            <Card key={post.id} className="p-3">
              <div className="flex items-start gap-2.5">
                <Avatar
                  name={post.author.display_name}
                  avatarUrl={post.author.avatar_url}
                  blocks={post.author.blocks}
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-caption">
                    {post.author.display_name}・
                    {format(new Date(post.created_at), "M月d日 HH:mm", { locale: ja })}
                  </p>
                  <div className="mt-1 whitespace-pre-wrap break-words text-body">
                    <Linkify text={post.body} />
                  </div>
                </div>
                {!post.id.startsWith("optimistic-") && (post.author_id === currentUserId || isAdmin) && (
                  <ActionMenu
                    onDelete={() => removePost(post.id)}
                    deleteTitle="投稿を削除しますか？"
                    deleteDescription="削除した投稿は元に戻せません。"
                  />
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <form
        className="fixed inset-x-0 bottom-[calc(52px+env(safe-area-inset-bottom))] z-30 mx-auto w-full max-w-md border-t border-separator bg-bg/90 px-3 py-2 backdrop-blur-xl"
        data-no-pull-refresh
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="flex items-end gap-2">
          <Textarea
            ref={textareaRef}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              resizeComposer(event.currentTarget);
            }}
            maxLength={2000}
            rows={1}
            placeholder="返信を書く"
            aria-label="返信を書く"
            className="min-h-11 max-h-32 flex-1 overflow-y-auto rounded-[22px] bg-card px-4 py-2.5 leading-6"
          />
          <Button
            type="submit"
            size="icon"
            className="h-11 w-11 shrink-0 rounded-full"
            disabled={!body.trim() || sending}
            aria-label="返信を送信"
          >
            <Send size={18} />
          </Button>
        </div>
      </form>
    </div>
  );
}
