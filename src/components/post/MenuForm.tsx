"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

/** 練習メニューを予定に追加する（担当者・管理者） */
export function MenuForm({ scheduleId }: { scheduleId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!content.trim()) {
      setError("メニュー内容を入力してください");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      return;
    }
    const { error } = await supabase.from("practice_menus").insert({
      schedule_id: scheduleId,
      author_id: user.id,
      content: content.trim(),
    });
    if (error) {
      setError("保存に失敗しました");
      setSaving(false);
      return;
    }
    setContent("");
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="mt-1 inline-flex items-center gap-1 text-[13px] text-accent font-medium active:opacity-50"
      >
        <Plus size={15} /> メニューを追加
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="練習メニューを追加">
          <div className="space-y-4 pb-4">
            <p className="text-caption">作成者として、あなたの名前が自動で表示されます。</p>
            <div>
              <p className="section-label mb-1.5">メニュー内容</p>
              <Textarea
                rows={6}
                placeholder={"例:\nW-up 2km\n本練習 1000m×5 (R3')\nD-down 2km"}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            {error && <p className="text-caption text-danger text-center">{error}</p>}
            <Button size="lg" onClick={submit} disabled={saving}>
              {saving ? "保存中…" : "追加する"}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
