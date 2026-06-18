"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
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

type UpcomingSchedule = {
  id: string;
  schedule_date: string;
  title: string | null;
  venue_name: string | null;
  schedule_type: string;
};

/**
 * FAB から練習メニューを作成するフォーム。
 * 今後の予定を一覧で取得し、対象の予定を選んでメニューを追加する。
 */
export function MenuComposerForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [schedules, setSchedules] = useState<UpcomingSchedule[] | null>(null);
  const [scheduleId, setScheduleId] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("practice_schedules")
        .select("id, schedule_date, title, venue_name, schedule_type")
        .gte("schedule_date", today)
        .order("schedule_date", { ascending: true });
      const rows = (data ?? []) as UpcomingSchedule[];
      setSchedules(rows);
      if (rows.length > 0) setScheduleId(rows[0].id);
    })();
  }, []);

  async function submit() {
    if (!scheduleId) {
      setError("対象の予定を選択してください");
      return;
    }
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
    router.refresh();
    onDone();
  }

  function scheduleLabel(s: UpcomingSchedule): string {
    const date = format(new Date(s.schedule_date + "T00:00:00"), "M/d(E)", { locale: ja });
    const name = s.title || s.venue_name || (s.schedule_type === "practice" ? "練習" : "予定");
    return `${date} ${name}`;
  }

  return (
    <div className="space-y-4 pb-4">
      {schedules === null ? (
        <p className="text-caption text-center py-6">予定を読み込み中…</p>
      ) : schedules.length === 0 ? (
        <p className="text-caption text-center py-6">
          メニューを追加できる今後の予定がありません。先に練習予定を作成してください。
        </p>
      ) : (
        <>
          <div>
            <p className="section-label mb-1.5">対象の予定</p>
            <select
              value={scheduleId}
              onChange={(e) => setScheduleId(e.target.value)}
              className="h-11 w-full rounded-xl bg-card border border-separator px-3 text-[15px] outline-none"
            >
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {scheduleLabel(s)}
                </option>
              ))}
            </select>
          </div>
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
        </>
      )}
    </div>
  );
}
