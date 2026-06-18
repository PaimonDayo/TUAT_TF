"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FullScreen, FullScreenContent } from "@/components/ui/fullscreen";
import { SegmentedControl } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { VENUES } from "@/lib/venues";
import { ENTRY_PERIOD_TYPES, SCHEDULE_TYPE_OPTIONS } from "@/lib/constants";
import type { ScheduleType } from "@/types";

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

export function ScheduleForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [type, setType] = useState<ScheduleType>("practice");
  const [date, setDate] = useState("");
  const [meetingTime, setMeetingTime] = useState("");
  const [venueKey, setVenueKey] = useState<string>("");
  const [otherVenue, setOtherVenue] = useState("");
  const [title, setTitle] = useState("");
  const [useEndDate, setUseEndDate] = useState(false);
  const [endDate, setEndDate] = useState("");
  const [useEntry, setUseEntry] = useState(false);
  const [entryStart, setEntryStart] = useState("");
  const [entryEnd, setEntryEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPractice = type === "practice";
  const canEntry = ENTRY_PERIOD_TYPES.includes(type);

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

    const venue = venueKey && venueKey !== OTHER ? VENUES.find((v) => v.key === venueKey) : undefined;
    const venueName = venue ? venue.name : venueKey === OTHER ? otherVenue.trim() || null : null;

    const { error } = await supabase.from("practice_schedules").insert({
      schedule_date: date,
      schedule_type: type,
      meeting_time: meetingTime || null,
      venue_name: venueName,
      venue_access: venue ? venue.access.join("\n") : null,
      venue_fee: venue ? venue.fee : null,
      venue_url: venue ? venue.url : null,
      title: !isPractice ? title.trim() || null : null,
      end_date: !isPractice && useEndDate && endDate ? endDate : null,
      entry_start: canEntry && useEntry && entryStart ? entryStart : null,
      entry_end: canEntry && useEntry && entryEnd ? entryEnd : null,
      created_by: user.id,
    });

    if (error) {
      setError("作成に失敗しました");
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
          {VENUES.map((v) => (
            <option key={v.key} value={v.key}>
              {v.key}：{v.name}
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
                onChange={() => setUseEndDate((v) => !v)}
              />
              {useEndDate && (
                <div className="mt-2">
                  <p className="text-micro mb-1">終了日</p>
                  <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
      </div>

      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <Button size="lg" onClick={submit} disabled={saving}>
        {saving ? "作成中…" : "作成する"}
      </Button>
    </div>
  );
}
