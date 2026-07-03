"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { safeUpdate, safeUpdateMessage } from "@/lib/safe-update";
import { ActionMenu } from "@/components/ui/action-menu";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { SegmentedControl } from "@/components/ui/segmented";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ScheduleSheetsManager } from "@/components/features/ScheduleSheetsManager";
import { MenuSheetImportManager } from "@/components/features/MenuSheetImportManager";
import {
  BLOCK_ORDER,
  BLOCKS,
  ENTRY_PERIOD_TYPES,
  SCHEDULE_TYPE_OPTIONS,
} from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { Block, PracticeSchedule, ScheduleType, VenueRow } from "@/types";

const OTHER = "__other__";

export function ScheduleCreatePanel({ onDone }: { onDone: () => void }) {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<"normal" | "sheets" | "menus">(
    searchParams.get("sheets") === "1" ? "sheets" : "normal",
  );

  return (
    <div className="space-y-5">
      <SegmentedControl
        items={[
          { key: "normal", label: "通常入力" },
          { key: "sheets", label: "予定をスプシから入力" },
          { key: "menus", label: "メニューをスプシから入力" },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === "normal" && <ScheduleForm onDone={onDone} />}
      {mode === "sheets" && <ScheduleSheetsManager />}
      {mode === "menus" && <MenuSheetImportManager />}
    </div>
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
  const [targetBlocks, setTargetBlocks] = useState<Block[]>(schedule?.target_blocks ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meetingTimeTouched = useRef(false);

  const isPractice = type === "practice";
  const canEntry = ENTRY_PERIOD_TYPES.includes(type);

  // 場所リスト（pinned）をDBから取得。編集時は保存済み会場名を選択状態に復元。
  useEffect(() => {
    let active = true;
    (async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const [venueResult, previousTimeResult] = await Promise.all([
        supabase
          .from("venues")
          .select("*")
          .eq("pinned", true)
          .order("sort", { ascending: true })
          .order("name", { ascending: true }),
        !schedule && user
          ? supabase
              .from("practice_schedules")
              .select("meeting_time")
              .eq("created_by", user.id)
              .eq("schedule_type", "practice")
              .not("meeting_time", "is", null)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      if (!active) return;
      const list = (venueResult.data ?? []) as VenueRow[];
      setVenues(list);
      const previousTime = previousTimeResult.data?.meeting_time;
      if (!schedule && previousTime && !meetingTimeTouched.current) {
        setMeetingTime(previousTime.slice(0, 5));
      }
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
      target_blocks: targetBlocks,
    };

    if (editing) {
      const result = await safeUpdate(
        supabase,
        "practice_schedules",
        payload,
        { id: schedule!.id },
      );
      if (!result.ok) {
        setError(safeUpdateMessage(result.reason));
        setSaving(false);
        return;
      }
    } else {
      const { error } = await supabase
        .from("practice_schedules")
        .insert({ ...payload, created_by: user.id });
      if (error) {
        setError("作成に失敗しました");
        setSaving(false);
        return;
      }
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

      <div>
        <p className="section-label mb-1.5">対象ブロック</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTargetBlocks([])}
            className={cn(
              "h-11 rounded-xl border text-[14px] font-semibold",
              targetBlocks.length === 0
                ? "border-accent bg-accent text-white"
                : "border-separator bg-card text-muted2",
            )}
          >
            全体
          </button>
          {BLOCK_ORDER.map((block) => {
            const meta = BLOCKS[block];
            const active = targetBlocks.includes(block);
            return (
              <button
                key={block}
                type="button"
                onClick={() =>
                  setTargetBlocks((current) =>
                    current.includes(block)
                      ? current.filter((item) => item !== block)
                      : [...current, block],
                  )
                }
                className="h-11 rounded-xl border text-[14px] font-semibold"
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
        <p className="text-micro mt-1.5">
          全体は全員に表示されます。個別ブロックは複数選択できます。
        </p>
      </div>

      {/* 日付（選ぶだけで設定。追加ボタン不要） */}
      <div>
        <p className="section-label mb-1.5">日付</p>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {/* 場所（選択式） */}
      <div>
        <p className="section-label mb-1.5">場所</p>
        <Select
          value={venueKey}
          onValueChange={setVenueKey}
          ariaLabel="場所"
          options={[
            { value: "", label: "選択しない" },
            ...venues.map((venue) => ({
              value: venue.id,
              label: venue.short ? `${venue.short}：${venue.name}` : venue.name,
            })),
            { value: OTHER, label: "その他（手入力）" },
          ]}
        />
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
            <div className="flex items-center gap-2">
              <Input
                type="time"
                value={meetingTime}
                onChange={(event) => {
                  meetingTimeTouched.current = true;
                  setMeetingTime(event.target.value);
                }}
              />
              <button
                type="button"
                onClick={() => {
                  meetingTimeTouched.current = true;
                  setMeetingTime("");
                }}
                disabled={!meetingTime}
                aria-label="集合時間をクリア"
                title="集合時間をクリア"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-separator bg-card text-muted active:bg-bg disabled:opacity-30"
              >
                <X size={18} />
              </button>
            </div>
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
      <FormModalFooter>
        <Button size="lg" onClick={submit} disabled={saving}>
          {saving ? "保存中…" : editing ? "更新する" : "作成する"}
        </Button>
      </FormModalFooter>
    </div>
  );
}

/** 予定の編集・削除（権限保持者向け）。予定カード内に表示 */
export function ScheduleManageActions({ schedule }: { schedule: PracticeSchedule }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [editOpen, setEditOpen] = useState(false);

  async function remove() {
    const supabase = createClient();
    const { error } = await supabase.from("practice_schedules").delete().eq("id", schedule.id);
    if (error) {
      showToast("予定を削除できませんでした");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <ActionMenu
        onEdit={() => setEditOpen(true)}
        onDelete={remove}
        deleteTitle="予定を削除しますか？"
        deleteDescription="予定に紐づく出欠と練習メニューも削除されます。"
        triggerLabel="予定のメニュー"
      />
      {editOpen && (
        <FormModal open onOpenChange={setEditOpen} title="予定を編集">
          <ScheduleForm schedule={schedule} onDone={() => setEditOpen(false)} />
        </FormModal>
      )}
    </>
  );
}
