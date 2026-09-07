"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FormModalFooter } from "@/components/ui/form-modal";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { prepareTweetImage } from "@/lib/tweet-image";
import { NoteImages, type NoteImage } from "@/components/features/NoteImages";
import type { AuthorMini, NoteArticleWithAuthor } from "@/types";

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
  const [pending, setPending] = useState<
    { id: string; name: string; blob: Blob }[]
  >([]);
  const [preparing, setPreparing] = useState(false);

  async function submit() {
    if (
      !title.trim() ||
      (!body.trim() &&
        !pending.length &&
        !images.some((i) => !removed.includes(i.id)))
    ) {
      setError("タイトルと、本文または写真を入力してください");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      title: title.trim(),
      body: body.trim(),
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

      router.refresh();
      onDone();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "記事を保存できませんでした",
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
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="残しておきたい知識や考えを入力"
          rows={16}
        />
      </div>
      <div className="space-y-2">
        <p className="section-label">写真（6枚まで）</p>
        <NoteImages images={images.filter((i) => !removed.includes(i.id))} />
        {images
          .filter((i) => !removed.includes(i.id))
          .map((image, index) => (
            <Button
              key={image.id}
              disabled={saving}
              onClick={() => setRemoved((old) => [...old, image.id])}
            >
              写真{index + 1}を外す
            </Button>
          ))}
        {pending.map((file) => (
          <div key={file.id} className="flex items-center gap-2 text-caption">
            <span className="min-w-0 flex-1 truncate">
              {file.name}（保存時に追加）
            </span>
            <Button
              disabled={saving}
              onClick={() =>
                setPending((old) => old.filter((p) => p.id !== file.id))
              }
            >
              外す
            </Button>
          </div>
        ))}
        <input
          aria-label="ノートに写真を追加"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={saving || preparing}
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            setError(null);
            if (
              files.length + pending.length + images.length - removed.length >
              6
            ) {
              setError("写真は1記事につき6枚まで追加できます");
              return;
            }
            setPreparing(true);
            try {
              const prepared: { id: string; name: string; blob: Blob }[] = [];
              for (const file of files)
                prepared.push({
                  id: crypto.randomUUID(),
                  name: file.name,
                  blob: await prepareTweetImage(file),
                });
              setPending((old) => [...old, ...prepared]);
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "写真を読み込めませんでした",
              );
            } finally {
              setPreparing(false);
            }
          }}
        />
        <p className="text-caption">
          JPG・PNG・WebP、1枚12MBまで。保存前に画像を圧縮します。
          {preparing ? "画像を準備中…" : ""}
        </p>
      </div>
      {error && <p className="text-center text-caption text-danger">{error}</p>}
      <FormModalFooter>
        <Button size="lg" disabled={saving || preparing} onClick={submit}>
          {saving ? "保存中…" : article ? "更新する" : "保存する"}
        </Button>
      </FormModalFooter>
    </div>
  );
}
