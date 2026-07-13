"use client";

import { useState } from "react";
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
    <div className="space-y-4">
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

      <div className="space-y-2" data-no-pull-refresh>
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="返信を書く"
        />
        <Button type="button" className="w-full" disabled={!body.trim() || sending} onClick={send}>
          <Send size={16} />
          投稿する
        </Button>
      </div>
    </div>
  );
}
