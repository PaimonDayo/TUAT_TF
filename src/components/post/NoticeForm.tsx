"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { NOTICE_CATEGORIES } from "@/lib/constants";
import type { NoticeCategory } from "@/types";

export function NoticeComposer({ autoOpen = false }: { autoOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="お知らせを投稿"
        className="h-9 px-1 flex items-center gap-1 text-accent text-[15px] active:opacity-50"
      >
        <Plus size={20} />
        投稿
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="お知らせを投稿">
          <NoticeForm onDone={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

export function NoticeForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [category, setCategory] = useState<NoticeCategory>("info");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [deadline, setDeadline] = useState("");
  const [pinHome, setPinHome] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim() || !content.trim()) {
      setError("タイトルと本文を入力してください");
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
    const { error } = await supabase.from("notices").insert({
      author_id: user.id,
      category,
      title: title.trim(),
      content: content.trim(),
      deadline: deadline || null,
      pin_home: pinHome,
    });
    if (error) {
      setError("投稿に失敗しました");
      setSaving(false);
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <div className="space-y-4 pb-4">
      <div>
        <p className="section-label mb-1.5">カテゴリ</p>
        <div className="grid grid-cols-4 gap-2">
          {(Object.keys(NOTICE_CATEGORIES) as NoticeCategory[]).map((c) => {
            const meta = NOTICE_CATEGORIES[c];
            const active = category === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className="h-10 rounded-xl border text-[13px] font-semibold transition-active active:scale-95"
                style={{
                  borderColor: active ? meta.color : "#e5e5ea",
                  backgroundColor: active ? meta.bg : "#fff",
                  color: active ? meta.color : "#8e8e93",
                }}
              >
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="section-label mb-1.5">タイトル</p>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
      </div>
      <div>
        <p className="section-label mb-1.5">本文</p>
        <Textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      <div>
        <p className="section-label mb-1.5">締切（任意）</p>
        <Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        <p className="text-micro mt-1">締切を設定すると、その日を過ぎたらホームから自動で消えます</p>
      </div>
      <button
        type="button"
        onClick={() => setPinHome((v) => !v)}
        className="w-full flex items-center justify-between rounded-xl bg-card border border-separator p-3.5 active:bg-bg"
      >
        <span className="text-[14px]">ホームに表示（重要なお知らせ）</span>
        <span
          className="h-6 w-10 rounded-full p-0.5 transition-colors flex"
          style={{ backgroundColor: pinHome ? "#34c759" : "#e5e5ea", justifyContent: pinHome ? "flex-end" : "flex-start" }}
        >
          <span className="h-5 w-5 rounded-full bg-white shadow" />
        </span>
      </button>
      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <Button size="lg" onClick={submit} disabled={saving}>
        {saving ? "投稿中…" : "投稿する"}
      </Button>
    </div>
  );
}
