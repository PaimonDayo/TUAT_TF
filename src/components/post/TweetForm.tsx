"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { Link2, LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import {
  TWEET_MAX_LENGTH,
  TWEET_RAW_MAX_LENGTH,
  tweetContentLength,
  tweetContentRemaining,
  tweetContentUrls,
} from "@/lib/tweet-content";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FormModalFooter } from "@/components/ui/form-modal";
import { cn } from "@/lib/utils";

/** つぶやきフォーム。tweet を渡すと編集モード */
export type TweetFormHandle = { save: () => void };
export const TweetForm = forwardRef<
  TweetFormHandle,
  {
    tweet?: { id: string; content: string };
    onDone: () => void;
    onDirtyChange?: (dirty: boolean) => void;
  }
>(function TweetForm({ tweet, onDone, onDirtyChange }, ref) {
  const router = useRouter();
  const editing = !!tweet;
  const [content, setContent] = useState(tweet?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialContent = tweet?.content ?? "";
  const effectiveLength = tweetContentLength(content);
  const remaining = tweetContentRemaining(content);
  const overLimit = remaining < 0;
  const urls = useMemo(() => tweetContentUrls(content), [content]);
  const progress = Math.min(100, (effectiveLength / TWEET_MAX_LENGTH) * 100);

  useEffect(() => {
    onDirtyChange?.(content !== initialContent);
  }, [content, initialContent, onDirtyChange]);
  useImperativeHandle(ref, () => ({ save: () => { void submit(); } }));

  async function submit() {
    const text = content.trim();
    if (!text) return;
    if (tweetContentLength(text) > TWEET_MAX_LENGTH) {
      setError(`本文は${TWEET_MAX_LENGTH.toLocaleString()}文字以内にしてください`);
      return;
    }
    setSaving(true);
    setError(null);

    const supabase = createClient();

    if (editing) {
      const result = await safeUpdate(supabase, "tweets", { content: text }, { id: tweet!.id });
      if (!result.ok) {
        setError(safeUpdateMessage(result.reason));
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("ログイン情報を確認できませんでした");
        setSaving(false);
        return;
      }
      const { error } = await supabase.from("tweets").insert({ user_id: user.id, content: text });
      if (error) {
        setError("投稿に失敗しました");
        setSaving(false);
        return;
      }
    }
    setContent("");
    router.refresh();
    onDone();
  }

  return (
    <div className="space-y-3 pb-4">
      <section className="overflow-hidden rounded-[16px] border border-separator/80 bg-card transition-colors focus-within:border-accent/50">
        <Textarea
          aria-label="つぶやき本文"
          rows={7}
          maxLength={TWEET_RAW_MAX_LENGTH}
          placeholder="つぶやきを入力"
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            if (error) setError(null);
          }}
          className="min-h-[180px] rounded-none border-0 bg-transparent px-4 py-4 text-[16px] leading-7 placeholder:text-muted/75 focus:border-transparent"
        />

        <div className="border-t border-separator/70 bg-bg/35">
          <div className="flex min-h-11 items-center justify-between gap-3 px-4 py-2.5">
            <div className="min-w-0 text-[12px] text-muted2">
              {urls.length > 0 && (
                <span className="flex items-center gap-1.5">
                  <Link2 size={14} className="text-accent" />
                  URL {urls.length}件 · 1件23文字換算
                </span>
              )}
            </div>
            <span
              className={cn(
                "shrink-0 text-[12px] font-semibold tabular-nums",
                overLimit ? "text-danger" : remaining <= 100 ? "text-warning" : "text-muted2",
              )}
            >
              {effectiveLength.toLocaleString()} / {TWEET_MAX_LENGTH.toLocaleString()}
            </span>
          </div>
          <div className="h-1 bg-separator/70">
            <div
              className={cn(
                "h-full rounded-r-full transition-[width,background-color] duration-200",
                overLimit ? "bg-danger" : remaining <= 100 ? "bg-warning" : "bg-accent",
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-xl bg-danger/8 px-3 py-2.5 text-[13px] text-danger">
          {error}
        </p>
      )}

      <FormModalFooter>
        <Button size="lg" onClick={submit} disabled={saving || !content.trim() || overLimit}>
          {saving ? (
            <>
              <LoaderCircle size={18} className="animate-spin" />
              保存しています…
            </>
          ) : (
            <>
              <Send size={17} />
              {editing ? "更新する" : "投稿する"}
            </>
          )}
        </Button>
      </FormModalFooter>
    </div>
  );
});
