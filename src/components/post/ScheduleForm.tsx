"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FullScreen, FullScreenContent } from "@/components/ui/fullscreen";
import { SegmentedControl } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { ENTRY_PERIOD_TYPES, SCHEDULE_TYPE_OPTIONS } from "@/lib/constants";
import type { PracticeSchedule, ScheduleType, VenueRow } from "@/types";

const OTHER = "__other__";

/** ヘッダー右の「＋作成」ボタン。?compose=1 で自動オープン（全画面モーダル） */
export function ScheduleComposer({ autoOpen = false }: { autoOpen?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="予定を作成"
        className="h-9 px-1 flex items-center gap-1 text-accent text-[15px] active:opacity-50"
      >
        <Plus size={20} />
        作成
      </button>
      <FullScreen open={open} onOpenChange={setOpen}>
        <FullScreenContent title="予定を作成">
          <ScheduleForm onDone={() => setOpen(false)} />
        </FullScreenContent>
      </FullScreen>
    </>
  );
}

export function ScheduleForm({
  schedule,
  onDone,
}: {
  schedule?: PracticeSchedule;
  onDone: () => void;
}) {
  const router = useRouter();
  const editing = !!schedule;

  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [type, setType] = useState<ScheduleType>(schedule?.schedule_type ?? "practice");
  const [date, setDate] = useState(schedule?.schedule_date ?? "");
  const [meetingTime, setMeetingTime] = useState(schedule?.meeting_time?.slice(0, 5) ?? "");
  const [venueKey, setVenueKey] = useState<string>(schedule?.venue_name ? OTHER : "");
  const [otherVenue, setOtherVenue] = useState(schedule?.venue_name ?? "");
  const [title, setTitle] = useState(schedule?.title ?? "");
  const [useEndDate, setUseEndDate] = useState(!!schedule?.end_date);
  const [endDate, setEndDate] = useState(schedule?.end_date ?? "");
  const [useEntry, setUseEntry] = useState(!!(schedule?.entry_start || schedule?.entry_end));
  const [entryStart, setEntryStart] = useState(schedule?.entry_start ?? "");
  const [entryEnd, setEntryEnd] = useState(schedule?.entry_end ?? "");
  const [useDetail, setUseDetail] = useState(!!schedule?.note);
  const [detail, setDetail] = useState(schedule?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPractice = type === "practice";
  const canEntry = ENTRY_PERIOD_TYPES.includes(type);

  // 場所リスト（pinned）をDBから取得。編集時は保存済み会場名を選択状態に復元。
  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("venues")
        .select("*")
        .eq("pinned", true)
        .order("sort", { ascending: true })
        .order("name", { ascending: true });
      if (!active) return;
      const list = (data ?? []) as VenueRow[];
      setVenues(list);
      if (schedule?.venue_name) {
        const match = list.find((v) => v.name === schedule.venue_name);
        if (match) {
          setVenueKey(match.id);
          setOtherVenue("");
        }
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit() {
    if (!date) {
      setError("日付を選択してください");
      return;
    }
    if (!isPractice && !title.trim()) {
      setError("タイトルを入力してください");
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

    const venue = venueKey && venueKey !== OTHER ? venues.find((v) => v.id === venueKey) : undefined;
    const venueName = venue ? venue.name : venueKey === OTHER ? otherVenue.trim() || null : null;

    const payload = {
      schedule_date: date,
      schedule_type: type,
      meeting_time: meetingTime || null,
      venue_name: venueName,
      venue_access: venue ? venue.access : null,
      venue_fee: venue ? venue.fee : null,
      venue_url: venue ? venue.url : null,
      title: !isPractice ? title.trim() || null : null,
      end_date: !isPractice && useEndDate && endDate ? endDate : null,
      entry_start: canEntry && useEntry && entryStart ? entryStart : null,
      entry_end: canEntry && useEntry && entryEnd ? entryEnd : null,
      note: useDetail && detail.trim() ? detail.trim() : null,
    };

    const { error } = editing
      ? await supabase.from("practice_schedules").update(payload).eq("id", schedule!.id)
      : await supabase.from("practice_schedules").insert({ ...payload, created_by: user.id });

    if (error) {
      setError(editing ? "更新に失敗しました" : "作成に失敗しました");
      setSaving(false);
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <div className="space-y-4 pb-4">
      <SegmentedControl
        items={SCHEDULE_TYPE_OPTIONS}
        value={type}
        onChange={(k) => setType(k as ScheduleType)}
      />

      {/* 日付（選ぶだけで設定。追加ボタン不要） */}
      <div>
        <p className="section-label mb-1.5">日付</p>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {/* 場所（選択式） */}
      <div>
        <p className="section-label mb-1.5">場所</p>
        <select
          value={venueKey}
          onChange={(e) => setVenueKey(e.target.value)}
          className="h-11 w-full rounded-xl bg-card border border-separator px-3 text-[15px] outline-none"
        >
          <option value="">選択しない</option>
          {venues.map((v) => (
            <option key={v.id} value={v.id}>
              {v.short ? `${v.short}：${v.name}` : v.name}
            </option>
          ))}
          <option value={OTHER}>その他（手入力）</option>
        </select>
        {venueKey === OTHER && (
          <Input
            className="mt-2"
            placeholder="場所名を入力"
            value={otherVenue}
            onChange={(e) => setOtherVenue(e.target.value)}
          />
        )}
        {venueKey && venueKey !== OTHER && (
          <p className="text-caption mt-1.5">アクセス・参加費は自動で登録されます</p>
        )}
      </div>

      {/* 種別ごとの項目（全画面モーダルなので高さが変わってもガクつかない） */}
      <div key={type} className="space-y-4 fade-in">
        {isPractice ? (
          <div>
            <p className="section-label mb-1.5">集合時間</p>
            <Input type="time" value={meetingTime} onChange={(e) => setMeetingTime(e.target.value)} />
          </div>
        ) : (
          <>
            <div>
              <p className="section-label mb-1.5">タイトル</p>
              <Input
                placeholder={type === "meet" ? "例: 県選手権 / 合宿" : "例: 記録会"}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {/* 終了日：複数日開催のときだけオン */}
            <div>
              <Toggle
                label="複数日開催（終了日を設定）"
                checked={useEndDate}
                onChange={() =>
                  setUseEndDate((v) => {
                    const next = !v;
                    if (next && !endDate && date) setEndDate(date);
                    return next;
                  })
                }
              />
              {useEndDate && (
                <div className="mt-2">
                  <p className="text-micro mb-1">終了日</p>
                  <Input
                    type="date"
                    value={endDate}
                    min={date || undefined}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {/* エントリー期間（大会・記録会） */}
        {canEntry && (
          <div>
            <Toggle
              label="エントリー期間を設定する"
              checked={useEntry}
              onChange={() => setUseEntry((v) => !v)}
            />
            {useEntry && (
              <div className="space-y-2 mt-2">
                <div>
                  <p className="text-micro mb-1">エントリー開始</p>
                  <Input type="date" value={entryStart} onChange={(e) => setEntryStart(e.target.value)} />
                </div>
                <div>
                  <p className="text-micro mb-1">エントリー締切</p>
                  <Input type="date" value={entryEnd} onChange={(e) => setEntryEnd(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 詳細情報（任意）— エントリーフォームのリンクや補足情報など */}
        <div>
          <Toggle
            label="詳細情報を追加する"
            checked={useDetail}
            onChange={() => setUseDetail((v) => !v)}
          />
          {useDetail && (
            <div className="mt-2">
              <Textarea
                rows={4}
                placeholder={"エントリーフォームや補足情報など\n例: [エントリーはこちら](https://...)"}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
              />
              <p className="text-micro mt-1">
                URLはそのまま貼ってもリンクになります。[文字](URL) で文字にリンクも貼れます。
              </p>
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <Button size="lg" onClick={submit} disabled={saving}>
        {saving ? "保存中…" : editing ? "更新する" : "作成する"}
      </Button>
    </div>
  );
}

/** 予定の編集・削除（権限保持者向け）。予定カード内に表示 */
export function ScheduleManageActions({ schedule }: { schedule: PracticeSchedule }) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function del() {
    if (!confirm("この予定を削除しますか？")) return;
    setDeleting(true);
    const supabase = createClient();
    await supabase.from("practice_schedules").delete().eq("id", schedule.id);
    router.refresh();
  }

  return (
    <div className="flex gap-2 pt-1">
      <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="gap-1">
        <Pencil size={15} /> 編集
      </Button>
      <Button variant="ghost" size="sm" onClick={del} disabled={deleting} className="gap-1 text-danger">
        <Trash2 size={15} /> {deleting ? "削除中…" : "削除"}
      </Button>

      <FullScreen open={editOpen} onOpenChange={setEditOpen}>
        <FullScreenContent title="予定を編集">
          <ScheduleForm schedule={schedule} onDone={() => setEditOpen(false)} />
        </FullScreenContent>
      </FullScreen>
    </div>
  );
}
