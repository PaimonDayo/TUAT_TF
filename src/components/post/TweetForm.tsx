"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { Link2, LoaderCircle, MessageCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import {
  TWEET_MAX_LENGTH,
  TWEET_RAW_MAX_LENGTH,
  tweetContentLength,
  tweetContentRemaining,
  tweetContentUrls,
  tweetUrlHost,
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
    <div className="space-y-4 pb-4">
      <section className="overflow-hidden rounded-[22px] border border-separator/80 bg-card shadow-[0_10px_35px_rgba(0,0,0,0.04)] transition-shadow focus-within:border-accent/50 focus-within:shadow-[0_12px_40px_rgba(0,122,255,0.10)]">
        <div className="flex items-center gap-3 border-b border-separator/70 bg-bg/55 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <MessageCircle size={18} strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <p className="text-headline">{editing ? "内容を整える" : "みんなに共有"}</p>
            <p className="text-caption">練習の気づき、連絡、参考リンクなどを自由に</p>
          </div>
        </div>

        <Textarea
          aria-label="つぶやき本文"
          aria-describedby="tweet-length-help"
          rows={8}
          maxLength={TWEET_RAW_MAX_LENGTH}
          placeholder={"今日はどんな一日でしたか？\nリンクもそのまま貼れます"}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            if (error) setError(null);
          }}
          className="min-h-[210px] rounded-none border-0 bg-transparent px-4 py-4 text-[16px] leading-7 placeholder:text-muted/75 focus:border-transparent"
        />

        <div className="border-t border-separator/70 bg-bg/45">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-muted2">
              <Link2 size={15} className={urls.length > 0 ? "text-accent" : "text-muted"} />
              <span>{urls.length > 0 ? `${urls.length}件のリンクを検出` : "URLは自動でリンク化"}</span>
            </div>
            <span
              className={cn(
                "shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold tabular-nums",
                overLimit
                  ? "bg-danger/10 text-danger"
                  : remaining <= 100
                    ? "bg-warning/10 text-warning"
                    : "bg-card text-muted2",
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
          {urls.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-separator/60 px-4 py-2.5">
              {urls.slice(0, 4).map((url) => (
                <span
                  key={url}
                  className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent/8 px-2.5 py-1 text-[11px] font-medium text-accent"
                >
                  <Link2 size={12} />
                  <span className="truncate">{tweetUrlHost(url)}</span>
                </span>
              ))}
              {urls.length > 4 && (
                <span className="rounded-full bg-card px-2.5 py-1 text-[11px] font-medium text-muted2">
                  +{urls.length - 4}
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      <p id="tweet-length-help" className="px-1 text-[12px] leading-5 text-muted2">
        URLは長さにかかわらず1件23文字として数えます。改行や絵文字も使えます。
      </p>

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
