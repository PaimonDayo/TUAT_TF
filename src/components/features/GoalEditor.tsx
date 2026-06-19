"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Target, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { FormModal } from "@/components/ui/form-modal";

/**
 * 目標（自由入力）の表示＆編集ボタン。
 * 「大会・記録会の結果」と同じ並びに置くカード型のボタン。
 */
export function GoalEditor({
  userId,
  goal: initialGoal,
}: {
  userId: string;
  goal: string | null;
}) {
  const router = useRouter();
  const [goal, setGoal] = useState(initialGoal ?? "");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(goal);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openSheet() {
    setDraft(goal);
    setError(null);
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ goal: draft.trim() || null })
      .eq("id", userId);
    if (error) {
      setError("保存に失敗しました");
      setSaving(false);
      return;
    }
    setGoal(draft.trim());
    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={openSheet}
        className="flex w-full items-center gap-3 p-4 text-left active:bg-bg"
      >
        <Target size={20} className="text-accent" />
        <span className="flex-1 text-headline">目標</span>
        <ChevronRight size={18} className="text-muted" />
      </button>

      <FormModal open={open} onOpenChange={setOpen} title="目標を設定" autoFocus={false}>
        <div className="space-y-4 pb-4">
          <div>
            <p className="section-label mb-1.5">目標（自由入力）</p>
            <Textarea
              rows={3}
              placeholder="例: 関カレ出場 / 5000m 14分台 / 自己ベスト更新"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={100}
            />
            <p className="text-micro mt-1">プロフィールに表示され、何に向けて頑張っているか共有できます。</p>
          </div>
          {error && <p className="text-caption text-danger text-center">{error}</p>}
          <Button size="lg" onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存する"}
          </Button>
        </div>
      </FormModal>
    </>
  );
}
