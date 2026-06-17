"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SegmentedControl } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { VENUES } from "@/lib/venues";
import { ENTRY_PERIOD_TYPES, SCHEDULE_TYPE_OPTIONS } from "@/lib/constants";
import type { ScheduleType } from "@/types";

const OTHER = "__other__";

/** ヘッダー右の「＋作成」ボタン。?compose=1 で自動オープン */
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
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title="予定を作成">
          <ScheduleForm onDone={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}

function ScheduleForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [type, setType] = useState<ScheduleType>("practice");
  const [dates, setDates] = useState<string[]>([]);
  const [dateInput, setDateInput] = useState("");
  const [meetingTime, setMeetingTime] = useState("");
  const [venueKey, setVenueKey] = useState<string>("");
  const [otherVenue, setOtherVenue] = useState("");
  const [title, setTitle] = useState("");
  const [endDate, setEndDate] = useState("");
  const [useEntry, setUseEntry] = useState(false);
  const [entryStart, setEntryStart] = useState("");
  const [entryEnd, setEntryEnd] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPractice = type === "practice";
  const canEntry = ENTRY_PERIOD_TYPES.includes(type);

  function addDate() {
    if (dateInput && !dates.includes(dateInput)) {
      setDates((d) => [...d, dateInput].sort());
      setDateInput("");
    }
  }

  async function submit() {
    if (dates.length === 0) {
      setError("日付を1つ以上追加してください");
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

    const base = {
      schedule_type: type,
      meeting_time: meetingTime || null,
      venue_name: venueName,
      venue_access: venue ? venue.access.join("\n") : null,
      venue_fee: venue ? venue.fee : null,
      venue_url: venue ? venue.url : null,
      title: !isPractice ? title.trim() || null : null,
      end_date: !isPractice && endDate ? endDate : null,
      entry_start: canEntry && useEntry && entryStart ? entryStart : null,
      entry_end: canEntry && useEntry && entryEnd ? entryEnd : null,
      created_by: user.id,
    };

    // 複数日をまとめて作成
    const rows = dates.map((d) => ({ ...base, schedule_date: d }));
    const { error } = await supabase.from("practice_schedules").insert(rows);

    if (error) {
      setError("作成に失敗しました");
      setSaving(false);
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <div className="space-y-4 pb-4 max-h-[72vh] overflow-y-auto">
      <SegmentedControl
        items={SCHEDULE_TYPE_OPTIONS}
        value={type}
        onChange={(k) => setType(k as ScheduleType)}
      />

      {/* 日付（複数まとめて）— 共通 */}
      <div>
        <p className="section-label mb-1.5">日付（複数まとめて追加できます）</p>
        <div className="flex gap-2">
          <Input type="date" value={dateInput} onChange={(e) => setDateInput(e.target.value)} />
          <Button size="md" variant="outline" onClick={addDate} className="px-4 shrink-0">
            追加
          </Button>
        </div>
        {dates.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {dates.map((d) => (
              <span
                key={d}
                className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full bg-accent/10 text-accent text-[12px] font-semibold"
              >
                {format(new Date(d + "T00:00:00"), "M/d(E)", { locale: ja })}
                <button
                  type="button"
                  onClick={() => setDates((arr) => arr.filter((x) => x !== d))}
                  className="h-5 w-5 flex items-center justify-center"
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 場所（選択式）— 共通 */}
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

      {/* 種別ごとの項目（切替時にフェード・高さを確保してガクつき防止） */}
      <div key={type} className="space-y-4 fade-in min-h-[150px]">
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
            <div>
              <p className="section-label mb-1.5">終了日（任意・複数日開催）</p>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </>
        )}

        {/* エントリー期間（大会・記録会） */}
        {canEntry && (
          <div>
            <button
              type="button"
              onClick={() => setUseEntry((v) => !v)}
              className="w-full flex items-center justify-between rounded-xl bg-card border border-separator p-3.5 active:bg-bg"
            >
              <span className="text-[14px]">エントリー期間を設定する</span>
              <span
                className="h-6 w-10 rounded-full p-0.5 transition-colors flex"
                style={{
                  backgroundColor: useEntry ? "#34c759" : "#e5e5ea",
                  justifyContent: useEntry ? "flex-end" : "flex-start",
                }}
              >
                <span className="h-5 w-5 rounded-full bg-white shadow" />
              </span>
            </button>
            {useEntry && (
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <p className="text-micro mb-1">開始</p>
                  <Input type="date" value={entryStart} onChange={(e) => setEntryStart(e.target.value)} />
                </div>
                <div>
                  <p className="text-micro mb-1">締切</p>
                  <Input type="date" value={entryEnd} onChange={(e) => setEntryEnd(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-caption text-danger text-center">{error}</p>}
      <Button size="lg" onClick={submit} disabled={saving}>
        {saving ? "作成中…" : dates.length > 1 ? `${dates.length}件まとめて作成` : "作成する"}
      </Button>
    </div>
  );
}
