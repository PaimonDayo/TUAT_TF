"use client";
/* eslint-disable @next/next/no-img-element -- local object URL preview */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { Clock3, ImagePlus, Link2, LoaderCircle, Plus, Send, X } from "lucide-react";
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
import { Toggle } from "@/components/ui/toggle";
import { FormModalFooter } from "@/components/ui/form-modal";
import { cn } from "@/lib/utils";
import { prepareTweetImage, TWEET_IMAGE_BUCKET, validateTweetImage } from "@/lib/tweet-image";

/** つぶやきフォーム。tweet を渡すと編集モード */
export type TweetFormHandle = { save: () => void };
export const TweetForm = forwardRef<
  TweetFormHandle,
  {
    tweet?: { id: string; content: string };
    initialStory?: boolean;
    onDone: () => void;
    onDirtyChange?: (dirty: boolean) => void;
  }
>(function TweetForm({ tweet, initialStory = false, onDone, onDirtyChange }, ref) {
  const router = useRouter();
  const editing = !!tweet;
  const [content, setContent] = useState(tweet?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiresIn24Hours, setExpiresIn24Hours] = useState(initialStory);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [members, setMembers] = useState<Array<{ id: string; display_name: string }>>([]);
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([]);
  const [pollEnabled, setPollEnabled] = useState(false);
  const [pollOptions, setPollOptions] = useState(["", ""]);
  const [pollMultiple, setPollMultiple] = useState(false);
  const [pollAnonymous, setPollAnonymous] = useState(true);
  const [pollAllowOptions, setPollAllowOptions] = useState(false);
  const mentionMatch = content.match(/@([^@\n]*)$/);
  const mentionQuery = mentionMatch?.[1]?.trim().toLocaleLowerCase("ja") ?? null;
  const imagePreview = useMemo(() => imageFile ? URL.createObjectURL(imageFile) : null, [imageFile]);
  const initialContent = tweet?.content ?? "";
  const effectiveLength = tweetContentLength(content);
  const remaining = tweetContentRemaining(content);
  const overLimit = remaining < 0;
  const urls = useMemo(() => tweetContentUrls(content), [content]);
  const progress = Math.min(100, (effectiveLength / TWEET_MAX_LENGTH) * 100);

  useEffect(() => {
    onDirtyChange?.(content !== initialContent || !!imageFile || expiresIn24Hours !== initialStory || pollEnabled);
  }, [content, imageFile, expiresIn24Hours, initialContent, initialStory, onDirtyChange, pollEnabled]);
  useImperativeHandle(ref, () => ({ save: () => { void submit(); } }));
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("id, display_name")
      .eq("status", "active")
      .order("display_name")
      .then(({ data }) => setMembers(data ?? []));
  }, []);

  function selectMention(member: { id: string; display_name: string }) {
    setContent((value) => value.replace(/@([^@\n]*)$/, `@${member.display_name} `));
    setSelectedMentionIds((ids) => ids.includes(member.id) ? ids : [...ids, member.id]);
  }



  async function submit() {
    const text = content.trim();
    const cleanPollOptions = pollOptions.map((option) => option.trim()).filter(Boolean);
    if (imageFile && !expiresIn24Hours) {
      setError("画像はストーリーにだけ追加できます");
      return;
    }
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
      const id = crypto.randomUUID();
      let imagePath: string | null = null;
      if (imageFile) {
        let prepared: Blob;
        try {
          prepared = await prepareTweetImage(imageFile);
        } catch (imageError) {
          setError(imageError instanceof Error ? imageError.message : "画像を変換できませんでした");
          setSaving(false);
          return;
        }
        imagePath = `${user.id}/${id}.webp`;
        const { error: uploadError } = await supabase.storage
          .from(TWEET_IMAGE_BUCKET)
          .upload(imagePath, prepared, { contentType: "image/webp" });
        if (uploadError) {
          setError("画像をアップロードできませんでした");
          setSaving(false);
          return;
        }
      }
      const expiresAt = expiresIn24Hours ? new Date(Date.now() + 86400000).toISOString() : null;
      const { error } = await supabase.from("tweets").insert({
        id, user_id: user.id, content: text, image_path: imagePath, expires_at: expiresAt,
        poll_multiple: pollEnabled && pollMultiple,
        poll_anonymous: pollAnonymous,
        poll_allow_options: pollEnabled && pollAllowOptions,
      });
      if (error && imagePath) await supabase.storage.from(TWEET_IMAGE_BUCKET).remove([imagePath]);
      if (error) {
        setError("保存できませんでした。もう一度お試しください");
        setSaving(false);
        return;
      }
      if (pollEnabled) {
        const { error: pollError } = await supabase.from("tweet_poll_options").insert(
          cleanPollOptions.map((option, sortOrder) => ({
            tweet_id: id,
            text: option,
            created_by: user.id,
            sort_order: sortOrder,
          })),
        );
        if (pollError) {
          await supabase.from("tweets").delete().eq("id", id);
          setError("投票を保存できませんでした");
          setSaving(false);
          return;
        }
      }
      const activeMentionIds = selectedMentionIds.filter((profileId) => {
        const member = members.find((candidate) => candidate.id === profileId);
        return member ? text.includes(`@${member.display_name}`) : false;
      });
      if (activeMentionIds.length) {
        await supabase.from("tweet_mentions").insert(
          activeMentionIds.map((profileId) => ({ tweet_id: id, profile_id: profileId })),
        );
      }
    }
    setContent("");
    setImageFile(null);
    setExpiresIn24Hours(false);
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
          onKeyDown={(event) => {
            // Keep Enter as a newline in the post body. In particular, do not
            // let an edit modal (or a parent keyboard shortcut) treat it as
            // the confirmation key.
            if (event.key === "Enter") event.stopPropagation();
          }}
          onChange={(event) => {
            setContent(event.target.value);
            if (error) setError(null);
          }}
          className="min-h-[180px] rounded-none border-0 bg-transparent px-4 py-4 text-[16px] leading-7 placeholder:text-muted/75 focus:border-transparent"
        />
        {mentionQuery !== null && (
          <div className="border-t border-separator bg-bg p-2">
            <p className="px-2 pb-1 text-micro">メンションする人</p>
            <div className="max-h-40 overflow-y-auto">
              {members
                .filter((member) => member.display_name.toLocaleLowerCase("ja").includes(mentionQuery))
                .slice(0, 6)
                .map((member) => (
                  <button
                    key={member.id}
                    type="button"
                    className="flex min-h-10 w-full items-center rounded-lg px-2 text-left text-[14px] active:bg-card"
                    onClick={() => selectMention(member)}
                  >
                    @{member.display_name}
                  </button>
                ))}
            </div>
          </div>
        )}

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

      {!editing && (
        <div className="space-y-2">
          <button
            type="button"
            aria-label="投稿に追加"
            aria-expanded={pollEnabled}
            onClick={() => setPollEnabled((value) => !value)}
            className={cn(
              "grid h-10 w-10 place-items-center rounded-full border",
              pollEnabled ? "border-accent bg-accent text-white" : "border-separator bg-card text-accent",
            )}
          >
            <Plus size={20} className={cn("transition-transform", pollEnabled && "rotate-45")} />
          </button>
          {pollEnabled && (
            <section className="space-y-3 rounded-[16px] border border-separator bg-card p-3">
              <p className="text-[14px] font-semibold">投票</p>
              <div className="space-y-2">
                {pollOptions.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      value={option}
                      maxLength={80}
                      placeholder={`選択肢 ${index + 1}`}
                      className="h-10 min-w-0 flex-1 rounded-xl border border-separator bg-bg px-3 text-[14px]"
                      onChange={(event) => setPollOptions((options) => options.map((value, optionIndex) => optionIndex === index ? event.target.value : value))}
                    />
                    {pollOptions.length > 2 && (
                      <button type="button" aria-label="選択肢を削除" className="grid h-10 w-10 place-items-center text-muted" onClick={() => setPollOptions((options) => options.filter((_, optionIndex) => optionIndex !== index))}>
                        <X size={17} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {pollOptions.length < 6 && (
                <button type="button" className="text-[13px] font-semibold text-accent" onClick={() => setPollOptions((options) => [...options, ""])}>
                  ＋ 選択肢を追加
                </button>
              )}
              <div className="divide-y divide-separator/70 overflow-hidden rounded-xl border border-separator">
                <Toggle variant="row" label="複数投票" checked={pollMultiple} onChange={() => setPollMultiple((value) => !value)} />
                <Toggle variant="row" label="匿名投票" checked={pollAnonymous} onChange={() => setPollAnonymous((value) => !value)} />
                <Toggle variant="row" label="選択肢の追加を許可" checked={pollAllowOptions} onChange={() => setPollAllowOptions((value) => !value)} />
              </div>
            </section>
          )}
        </div>
      )}
      {!editing && (
        <div className="space-y-2">
          <button
            type="button"
            aria-pressed={expiresIn24Hours}
            onClick={() => setExpiresIn24Hours((value) => {
              if (value) setImageFile(null);
              return !value;
            })}
            className={cn(
              "flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border text-[14px] font-semibold",
              expiresIn24Hours ? "border-accent bg-accent/10 text-accent" : "border-separator bg-card",
            )}
          >
            <Clock3 size={18} />
            ストーリーとして投稿
          </button>

          {expiresIn24Hours && (
            <div className="space-y-2">
              {imagePreview && (
                <div className="relative overflow-hidden rounded-2xl border border-separator">
                  <img src={imagePreview} alt="投稿画像のプレビュー" className="max-h-80 w-full object-contain" />
                  <button type="button" aria-label="画像を外す" onClick={() => setImageFile(null)} className="absolute right-2 top-2 rounded-full bg-black/65 p-2 text-white">
                    <X size={17} />
                  </button>
                </div>
              )}
              <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-separator bg-card text-[14px] font-semibold">
                <ImagePlus size={18} />画像を追加
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  try {
                    if (file) validateTweetImage(file);
                    setImageFile(file);
                    setError(null);
                  } catch (fileError) {
                    setImageFile(null);
                    setError(fileError instanceof Error ? fileError.message : "画像を選択できませんでした");
                  }
                }} />
              </label>
              <p className="text-center text-[12px] text-muted2">ストーリーは投稿から24時間後に自動で非表示になります</p>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-danger/8 px-3 py-2.5 text-[13px] text-danger">
          {error}
        </p>
      )}

      <FormModalFooter>
        <Button size="lg" onClick={submit} disabled={saving || (!content.trim() && !imageFile && !pollEnabled) || overLimit}>
          {saving ? (
            <>
              <LoaderCircle size={18} className="animate-spin" />
              保存中…
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
