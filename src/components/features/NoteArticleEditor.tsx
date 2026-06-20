"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

  async function submit() {
    if (!title.trim() || !body.trim()) {
      setError("タイトルと本文を入力してください");
      return;
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();
    const payload = {
      title: title.trim(),
      body: body.trim(),
    };

    if (article) {
      const runUpdate = () =>
        supabase
          .from("note_articles")
          .update(payload)
          .eq("id", article.id)
          .eq("note_id", noteId)
          .select("id");
      let { data, error: updateError } = await runUpdate();
      if (!updateError && (!data || data.length === 0)) {
        await supabase.auth.refreshSession();
        ({ data, error: updateError } = await runUpdate());
      }
      if (updateError || !data || data.length === 0) {
        setError("記事を更新できませんでした");
        setSaving(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase.from("note_articles").insert({
        ...payload,
        note_id: noteId,
        author_id: currentUser.id,
      });
      if (insertError) {
        setError("記事を保存できませんでした");
        setSaving(false);
        return;
      }
    }

    router.refresh();
    onDone();
  }

  return (
    <div className="space-y-5 pb-4">
      <div>
        <p className="section-label mb-1.5">タイトル</p>
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="記事のタイトル"
          maxLength={100}
        />
      </div>
      <div>
        <p className="section-label mb-1.5">本文</p>
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="残しておきたい知識や考えを書く"
          rows={16}
        />
      </div>
      {error && <p className="text-center text-caption text-danger">{error}</p>}
      <Button size="lg" disabled={saving} onClick={submit}>
        {saving ? "保存中..." : article ? "更新する" : "保存する"}
      </Button>
    </div>
  );
}
