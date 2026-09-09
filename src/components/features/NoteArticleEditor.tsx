"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, ImagePlus, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toggle } from "@/components/ui/toggle";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormModalFooter } from "@/components/ui/form-modal";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { prepareTweetImage } from "@/lib/tweet-image";
import type { NoteImage } from "@/components/features/NoteImages";
import type { AuthorMini, NoteArticleWithAuthor, NotePollOption } from "@/types";

const MAX_IMAGES = 6;

type PendingImage = { id: string; name: string; blob: Blob };

/** 保存前の写真のプレビューURL。差し替えのたびに前のURLを開放する。 */
function usePreviews(pending: PendingImage[]) {
  const previews = useMemo(
    () => pending.map((file) => ({ id: file.id, url: URL.createObjectURL(file.blob) })),
    [pending],
  );
  useEffect(
    () => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)),
    [previews],
  );
  return previews;
}

export function NoteArticleEditor({
  noteId,
  currentUser,
  article,
  onDone,
}: {
  noteId: string;
  currentUser: AuthorMini;
  article?: NoteArticleWithAuthor;
  onDone: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(article?.title ?? "");
  const [body, setBody] = useState(article?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState(article?.id);
  const [images, setImages] = useState<NoteImage[]>(article?.images ?? []);
  const [removed, setRemoved] = useState<string[]>([]);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const [preparing, setPreparing] = useState(false);

  // 投票。投稿済みの選択肢は、まだ票が入っていないものだけ外せる。
  const savedOptions = article?.pollOptions ?? [];
  const [pollEnabled, setPollEnabled] = useState(savedOptions.length > 0);
  const [keptOptions, setKeptOptions] = useState<NotePollOption[]>(savedOptions);
  const [newOptions, setNewOptions] = useState<string[]>(
    savedOptions.length > 0 ? [] : ["", ""],
  );
  const [pollMultiple, setPollMultiple] = useState(article?.poll_multiple ?? false);
  const [pollAnonymous, setPollAnonymous] = useState(article?.poll_anonymous ?? true);
  const [pollAllowOptions, setPollAllowOptions] = useState(
    article?.poll_allow_options ?? false,
  );
  const [confirmRemovePoll, setConfirmRemovePoll] = useState(false);

  const previews = usePreviews(pending);
  const liveImages = images.filter((image) => !removed.includes(image.id));
  const imageCount = liveImages.length + pending.length;

  function addFiles(files: File[]) {
    setError(null);
    if (files.length + imageCount > MAX_IMAGES) {
      setError(`写真は1記事につき${MAX_IMAGES}枚まで追加できます`);
      return;
    }
    setPreparing(true);
    void (async () => {
      try {
        const prepared: PendingImage[] = [];
        for (const file of files)
          prepared.push({
            id: crypto.randomUUID(),
            name: file.name,
            blob: await prepareTweetImage(file),
          });
        setPending((old) => [...old, ...prepared]);
      } catch (prepareError) {
        setError(
          prepareError instanceof Error
            ? prepareError.message
            : "写真を読み込めませんでした",
        );
      } finally {
        setPreparing(false);
      }
    })();
  }

  /** 投票の保存。記事を保存した後に呼ぶ。 */
  async function savePoll(articleId: string) {
    const supabase = createClient();
    const texts = newOptions.map((option) => option.trim()).filter(Boolean);

    if (!pollEnabled) {
      if (savedOptions.length === 0) return;
      const { error: deleteError } = await supabase
        .from("note_poll_options")
        .delete()
        .eq("article_id", articleId);
      if (deleteError) throw new Error("記事は保存しましたが、投票を削除できませんでした");
      return;
    }

    if (keptOptions.length + texts.length < 2)
      throw new Error("投票の選択肢は2つ以上入力してください");

    const dropped = savedOptions.filter(
      (option) => !keptOptions.some((kept) => kept.id === option.id),
    );
    if (dropped.length) {
      const { error: deleteError } = await supabase
        .from("note_poll_options")
        .delete()
        .in(
          "id",
          dropped.map((option) => option.id),
        );
      if (deleteError) throw new Error("記事は保存しましたが、選択肢を外せませんでした");
    }
    if (texts.length) {
      const { error: insertError } = await supabase.from("note_poll_options").insert(
        texts.map((text, index) => ({
          article_id: articleId,
          text,
          created_by: currentUser.id,
          sort_order: keptOptions.length + index,
        })),
      );
      if (insertError)
        throw new Error("記事は保存しましたが、投票の選択肢を保存できませんでした");
    }
  }

  async function submit() {
    if (!title.trim() || (!body.trim() && !pending.length && !liveImages.length && !pollEnabled)) {
      setError("タイトルと、本文・写真・投票のいずれかを入力してください");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      title: title.trim(),
      body: body.trim(),
      poll_multiple: pollEnabled && pollMultiple,
      poll_anonymous: pollAnonymous,
      poll_allow_options: pollEnabled && pollAllowOptions,
    };

    let articleId = savedId;
    try {
      if (articleId) {
        const result = await safeUpdate(supabase, "note_articles", payload, {
          id: articleId,
          note_id: noteId,
        });
        if (!result.ok) {
          setError(safeUpdateMessage(result.reason));
          setSaving(false);
          return;
        }
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from("note_articles")
          .insert({
            ...payload,
            note_id: noteId,
            author_id: currentUser.id,
          })
          .select("id")
          .single();
        if (insertError || !inserted) {
          setError("記事を保存できませんでした");
          setSaving(false);
          return;
        }
        articleId = inserted.id;
        setSavedId(articleId);
      }

      for (const id of removed) {
        const response = await fetch(`/api/note-image?id=${id}`, {
          method: "DELETE",
        });
        if (!response.ok)
          throw new Error(
            "記事は保存しましたが、写真を削除できませんでした。もう一度保存してください。",
          );
        setImages((old) => old.filter((i) => i.id !== id));
        setRemoved((old) => old.filter((i) => i !== id));
      }
      for (const file of pending) {
        const response = await fetch(
          `/api/note-image?articleId=${articleId}&uploadId=${file.id}`,
          {
            method: "POST",
            headers: { "Content-Type": file.blob.type },
            body: file.blob,
          },
        );
        if (!response.ok)
          throw new Error(
            "記事は保存しましたが、一部の写真を追加できませんでした。もう一度保存すると残りを追加します。",
          );
        const image = (await response.json()) as NoteImage;
        setImages((old) => [...old.filter((i) => i.id !== image.id), image]);
        setPending((old) => old.filter((i) => i.id !== file.id));
      }

      await savePoll(articleId);

      router.refresh();
      onDone();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "記事を保存できませんでした",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 pb-4">
      <div>
        <p className="section-label mb-1.5">タイトル</p>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="タイトルを入力"
          maxLength={100}
        />
      </div>

      <div>
        <p className="section-label mb-1.5">本文</p>
        <Textarea
          autoGrow
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="残しておきたい知識や考えを入力"
          rows={8}
          className="min-h-44"
        />
      </div>

      {/* 写真は本文のすぐ下。並びがそのまま記事の並びになる。 */}
      {imageCount > 0 && (
        <div className="space-y-2">
          <p className="section-label">
            写真（{imageCount}/{MAX_IMAGES}）
          </p>
          <div className="grid grid-cols-3 gap-2">
            {liveImages.map((image, index) => (
              <figure key={image.id} className="relative">
                <img
                  src={`/api/note-image?id=${image.id}`}
                  alt={`添付写真${index + 1}`}
                  className="aspect-square w-full rounded-xl object-cover"
                />
                <button
                  type="button"
                  aria-label={`写真${index + 1}を外す`}
                  disabled={saving}
                  onClick={() => setRemoved((old) => [...old, image.id])}
                  className="absolute right-1 top-1 rounded-full bg-black/65 p-1.5 text-white active:opacity-70"
                >
                  <X size={14} />
                </button>
              </figure>
            ))}
            {previews.map((preview, index) => (
              <figure key={preview.id} className="relative">
                <img
                  src={preview.url}
                  alt={`追加する写真${index + 1}`}
                  className="aspect-square w-full rounded-xl object-cover"
                />
                <span className="absolute inset-x-1 bottom-1 rounded-full bg-black/60 px-2 py-0.5 text-center text-[10px] text-white">
                  保存時に追加
                </span>
                <button
                  type="button"
                  aria-label={`追加する写真${index + 1}を外す`}
                  disabled={saving}
                  onClick={() =>
                    setPending((old) => old.filter((file) => file.id !== preview.id))
                  }
                  className="absolute right-1 top-1 rounded-full bg-black/65 p-1.5 text-white active:opacity-70"
                >
                  <X size={14} />
                </button>
              </figure>
            ))}
          </div>
        </div>
      )}

      {/* 追加できるものを1か所にまとめて、写真の入口を分かるようにする。 */}
      <div className="flex flex-wrap gap-2">
        <label
          className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-separator bg-card px-3.5 text-[14px] font-semibold active:bg-bg ${
            imageCount >= MAX_IMAGES ? "pointer-events-none opacity-40" : ""
          }`}
        >
          <ImagePlus size={18} className="text-accent" />
          写真を追加
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="sr-only"
            disabled={saving || preparing || imageCount >= MAX_IMAGES}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              addFiles(files);
            }}
          />
        </label>
        {!pollEnabled && (
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setPollEnabled(true);
              if (!keptOptions.length && !newOptions.length) setNewOptions(["", ""]);
            }}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-separator bg-card px-3.5 text-[14px] font-semibold active:bg-bg"
          >
            <BarChart3 size={18} className="text-accent" />
            投票を追加
          </button>
        )}
      </div>
      <p className="text-caption">
        写真はJPG・PNG・WebP、1枚12MBまで。保存前に圧縮します。
        {preparing ? "画像を準備中…" : ""}
      </p>

      {pollEnabled && (
        <section className="space-y-3 rounded-[16px] border border-separator bg-bg p-3">
          <div className="flex items-center justify-between">
            <p className="section-label">投票</p>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                savedOptions.length ? setConfirmRemovePoll(true) : setPollEnabled(false)
              }
              className="text-[13px] font-semibold text-danger active:opacity-60"
            >
              投票をやめる
            </button>
          </div>

          {keptOptions.map((option) => (
            <div key={option.id} className="flex items-center gap-2">
              <span className="min-h-11 min-w-0 flex-1 rounded-xl border border-separator bg-card px-3 py-3 text-[14px]">
                {option.text}
              </span>
              <span className="shrink-0 text-caption tabular-nums">
                {option.vote_count}票
              </span>
              <button
                type="button"
                aria-label={`${option.text}を外す`}
                disabled={saving || option.vote_count > 0}
                title={option.vote_count > 0 ? "票が入っている選択肢は外せません" : undefined}
                onClick={() =>
                  setKeptOptions((old) => old.filter((kept) => kept.id !== option.id))
                }
                className="grid h-10 w-10 shrink-0 place-items-center text-muted disabled:opacity-30"
              >
                <X size={18} />
              </button>
            </div>
          ))}

          {newOptions.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={option}
                maxLength={80}
                placeholder={`選択肢${keptOptions.length + index + 1}`}
                disabled={saving}
                onChange={(event) =>
                  setNewOptions((old) =>
                    old.map((value, i) => (i === index ? event.target.value : value)),
                  )
                }
              />
              <button
                type="button"
                aria-label="選択肢を削除"
                disabled={saving}
                onClick={() =>
                  setNewOptions((old) => old.filter((_, i) => i !== index))
                }
                className="grid h-10 w-10 shrink-0 place-items-center text-muted"
              >
                <X size={18} />
              </button>
            </div>
          ))}

          <button
            type="button"
            disabled={saving}
            onClick={() => setNewOptions((old) => [...old, ""])}
            className="inline-flex items-center gap-1 text-[13px] font-semibold text-accent active:opacity-60"
          >
            <Plus size={15} />
            選択肢を追加
          </button>

          <div className="space-y-1.5">
            <Toggle
              variant="row"
              label="複数投票"
              checked={pollMultiple}
              onChange={() => setPollMultiple((value) => !value)}
            />
            <Toggle
              variant="row"
              label="匿名投票"
              checked={pollAnonymous}
              onChange={() => setPollAnonymous((value) => !value)}
            />
            <Toggle
              variant="row"
              label="選択肢の追加を許可"
              checked={pollAllowOptions}
              onChange={() => setPollAllowOptions((value) => !value)}
            />
          </div>
          {savedOptions.length > 0 && (
            <p className="text-micro">
              票が入った選択肢は外せません。文言を直すときは新しい選択肢を足してください。
            </p>
          )}
        </section>
      )}

      {error && <p className="text-center text-caption text-danger">{error}</p>}

      <ConfirmDialog
        open={confirmRemovePoll}
        onOpenChange={setConfirmRemovePoll}
        title="投票をやめますか？"
        description="保存すると、選択肢とこれまでの票をすべて削除します。元に戻せません。"
        onConfirm={() => {
          setPollEnabled(false);
          setKeptOptions([]);
          setNewOptions([]);
          setConfirmRemovePoll(false);
        }}
      />

      <FormModalFooter>
        <Button size="lg" disabled={saving || preparing} onClick={submit}>
          {saving ? "保存中…" : article ? "更新する" : "保存する"}
        </Button>
      </FormModalFooter>
    </div>
  );
}
