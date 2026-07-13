"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FormModalFooter } from "@/components/ui/form-modal";

const MAX = 200;

/** つぶやきフォーム。tweet を渡すと編集モード */
export type TweetFormHandle = { save: () => void };
export const TweetForm = forwardRef<TweetFormHandle, { tweet?: { id: string; content: string }; onDone: () => void; onDirtyChange?: (dirty: boolean) => void }>(function TweetForm({ tweet, onDone, onDirtyChange }, ref) {
  const router = useRouter();
  const editing = !!tweet;
  const [content, setContent] = useState(tweet?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  useEffect(() => { onDirtyChange?.(touched); }, [onDirtyChange, touched]);
  useImperativeHandle(ref, () => ({ save: () => { void submit(); } }));

  async function submit() {
    const text = content.trim();
    if (!text) return;
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
    <div className="space-y-3 pb-4" onInputCapture={() => setTouched(true)}>
      <Textarea
        autoFocus
        rows={4}
        maxLength={MAX}
        placeholder="いまどうしてる？"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="flex items-center justify-between text-caption">
        <span className="tabular-nums">
          {content.length} / {MAX}
        </span>
        {error && <span className="text-danger">{error}</span>}
      </div>
      <FormModalFooter>
        <Button size="lg" onClick={submit} disabled={saving || !content.trim()}>
          {saving ? <><LoaderCircle size={18} className="animate-spin" />保存しています…</> : editing ? "更新する" : "投稿する"}
        </Button>
      </FormModalFooter>
    </div>
  );
});
