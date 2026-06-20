"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Check, Download, ExternalLink, Link2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { createClient } from "@/lib/supabase/client";
import { BLOCKS } from "@/lib/constants";
import type {
  ScheduleImportPreview,
  ScheduleImportRow,
  ScheduleSheetBlock,
  ScheduleSheetKind,
  ScheduleSheetWeekdayDefault,
  PracticeSchedule,
  VenueRow,
} from "@/types";

const BLOCK_OPTIONS: { value: ScheduleSheetBlock; label: string }[] = [
  { value: "all", label: "全体" },
  { value: "middle_long", label: "中長距離" },
  { value: "short", label: "短距離" },
  { value: "jump", label: "跳躍" },
  { value: "throw", label: "投擲" },
];

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const INITIAL_WEEKDAY_DEFAULTS: ScheduleSheetWeekdayDefault[] = WEEKDAYS.map(
  (_, weekday) => ({
    weekday,
    time: weekday === 1 || weekday === 3 ? "17:00" : weekday === 6 ? "09:00" : "",
    venueName: "",
  }),
);

export function ScheduleSheetsManager() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [kind, setKind] = useState<ScheduleSheetKind>("practice");
  const [block, setBlock] = useState<ScheduleSheetBlock>("all");
  const [inputMode, setInputMode] = useState<"new" | "edit">("new");
  const [existing, setExisting] = useState<PracticeSchedule[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [venues, setVenues] = useState<VenueRow[]>([]);
  const [weekdayDefaults, setWeekdayDefaults] = useState(
    INITIAL_WEEKDAY_DEFAULTS,
  );
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [source, setSource] = useState<"url" | "file">("url");
  const [sheetUrl, setSheetUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScheduleImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/google/status")
      .then((response) => response.json())
      .then((status) => {
        if (!active) return;
        setGoogleConnected(!!status.connected);
        setGoogleEmail(status.email ?? null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void supabase
      .from("venues")
      .select("*")
      .order("sort", { ascending: true })
      .then(({ data }) => {
        if (active) setVenues((data ?? []) as VenueRow[]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    let query = supabase
      .from("practice_schedules")
      .select("*")
      .eq("schedule_type", kind)
      .order("schedule_date", { ascending: true });
    if (kind === "practice") {
      const start = `${year}-${String(month).padStart(2, "0")}-01`;
      const nextMonth =
        month === 12
          ? `${year + 1}-01-01`
          : `${year}-${String(month + 1).padStart(2, "0")}-01`;
      query = query.gte("schedule_date", start).lt("schedule_date", nextMonth);
    } else {
      query = query.gte("schedule_date", new Date().toISOString().slice(0, 10));
    }
    void query.then(({ data }) => {
      if (!active) return;
      const targetBlocks = block === "all" ? [] : [block];
      setExisting(
        ((data ?? []) as PracticeSchedule[]).filter(
          (schedule) =>
            [...(schedule.target_blocks ?? [])].sort().join(",") ===
            [...targetBlocks].sort().join(","),
        ),
      );
      setSelectedIds([]);
    });
    return () => {
      active = false;
    };
  }, [block, kind, month, year]);

  function downloadTemplate() {
    const selected = existing.filter((schedule) => selectedIds.includes(schedule.id));
    const rows =
      inputMode === "edit"
        ? createExistingRows(selected, kind, block)
        : createTemplateRows(year, month, kind, block);
    const content = `\uFEFF${Papa.unparse(rows)}`;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      kind === "practice"
        ? `${year}-${String(month).padStart(2, "0")}-practice-${block}.csv`
        : `${kind}-${block}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function issueSpreadsheet() {
    if (inputMode === "edit" && selectedIds.length === 0) {
      setError("編集する予定を選択してください");
      return;
    }
    setIssuing(true);
    setError(null);
    const popup = window.open("", "_blank");
    const response = await fetch("/api/google/sheets/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        block,
        year: kind === "practice" ? year : undefined,
        month: kind === "practice" ? month : undefined,
        scheduleIds: inputMode === "edit" ? selectedIds : [],
        weekdayDefaults:
          kind === "practice" && inputMode === "new"
            ? weekdayDefaults.filter((item) => item.time || item.venueName)
            : [],
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      popup?.close();
      setError(result.error ?? "スプレッドシートを発行できませんでした");
      setIssuing(false);
      return;
    }
    setSheetUrl(result.url);
    setSheetId(result.id);
    setSource("url");
    setPreview(null);
    setIssuing(false);
    if (popup) popup.location.href = result.url;
  }

  async function selectFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
    setSheetId(null);
    setPreview(null);
    setError(null);
  }

  async function previewImport() {
    if (source === "url" && !sheetUrl.trim()) {
      setError("Googleスプレッドシートの共有URLを入力してください");
      return;
    }
    if (source === "file" && !csv) {
      setError("CSVファイルを選択してください");
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    let targetSheetId = sheetId;
    if (!targetSheetId) {
      const { data, error: createError } = await supabase
        .from("schedule_sheets")
        .insert({
          author_id: user.id,
          target_year: kind === "practice" ? year : null,
          target_month: kind === "practice" ? month : null,
          kind,
          target_block: block,
          sheet_url:
            source === "url"
              ? sheetUrl.trim()
              : `csv-upload://${fileName || "schedule.csv"}`,
          csv_url: source === "url" ? sheetUrl.trim() : null,
        })
        .select("id")
        .single();
      if (createError || !data) {
        setError("CSVの確認を開始できませんでした");
        setLoading(false);
        return;
      }
      targetSheetId = data.id as string;
      setSheetId(targetSheetId);
    }

    const response = await fetch("/api/schedule-sheets/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetId: targetSheetId,
        csv: source === "file" ? csv : undefined,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "CSVを確認できませんでした");
      setLoading(false);
      return;
    }
    setPreview(result as ScheduleImportPreview);
    setLoading(false);
  }

  async function apply() {
    if (!preview || !sheetId || applying) return;
    setApplying(true);
    setError(null);
    const rows = [...preview.additions, ...preview.updates].map(toRpcRow);
    const supabase = createClient();
    const { error: applyError } = await supabase.rpc("apply_schedule_sheet_import", {
      target_sheet_id: sheetId,
      import_rows: rows,
    });
    if (applyError) {
      setError("予定へ反映できませんでした");
      setApplying(false);
      return;
    }
    router.refresh();
    setPreview(null);
    setCsv("");
    setFileName("");
    setSheetUrl("");
    setSheetId(null);
    setApplying(false);
  }

  const applicable = preview
    ? preview.additions.length + preview.updates.length
    : 0;

  return (
    <div className="space-y-5 pb-4">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Step number={1} />
          <p className="text-headline">入力する予定の種類を選ぶ</p>
        </div>
        <SegmentedControl
          items={[
            { key: "practice", label: "練習予定" },
            { key: "meet", label: "大会" },
            { key: "time_trial", label: "記録会" },
          ]}
          value={kind}
          onChange={(value) => {
            setKind(value);
            setPreview(null);
            setSheetId(null);
          }}
        />
        {kind === "practice" && (
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              min={2020}
              max={2100}
              value={year}
              aria-label="年"
              onChange={(event) => {
                setYear(Number(event.target.value));
                setPreview(null);
                setSheetId(null);
              }}
            />
            <Input
              type="number"
              min={1}
              max={12}
              value={month}
              aria-label="月"
              onChange={(event) => {
                setMonth(Number(event.target.value));
                setPreview(null);
                setSheetId(null);
              }}
            />
          </div>
        )}
        <select
          value={block}
          onChange={(event) => {
            setBlock(event.target.value as ScheduleSheetBlock);
            setPreview(null);
            setSheetId(null);
          }}
          className="h-11 w-full rounded-xl border border-separator bg-card px-3 text-[15px] outline-none"
        >
          {BLOCK_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <SegmentedControl
          items={[
            { key: "new", label: "新しく入力" },
            { key: "edit", label: "既存を編集" },
          ]}
          value={inputMode}
          onChange={(value) => {
            setInputMode(value);
            setSelectedIds([]);
          }}
        />
        {inputMode === "edit" && (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-separator bg-card p-1">
            {existing.length === 0 ? (
              <p className="p-3 text-caption">該当する予定がありません。</p>
            ) : (
              existing.map((schedule) => {
                const active = selectedIds.includes(schedule.id);
                return (
                  <button
                    key={schedule.id}
                    type="button"
                    onClick={() =>
                      setSelectedIds((ids) =>
                        ids.includes(schedule.id)
                          ? ids.filter((id) => id !== schedule.id)
                          : [...ids, schedule.id],
                      )
                    }
                    className={`flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left ${
                      active ? "bg-accent/10" : "active:bg-bg"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold">
                        {schedule.title || schedule.venue_name || "練習予定"}
                      </span>
                      <span className="block text-micro">
                        {schedule.schedule_date}
                        {schedule.end_date ? ` - ${schedule.end_date}` : ""}
                      </span>
                    </span>
                    {active && <Check size={18} className="shrink-0 text-accent" />}
                  </button>
                );
              })
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <p className="text-headline">Googleスプレッドシートを発行</p>
          <p className="mt-1 text-caption">
            マイドライブに作成し、場所と対象ブロックのプルダウンを自動設定します。
          </p>
        </div>
        {googleConnected === false ? (
          <Button type="button" size="lg" asChild>
            <a href="/api/google/connect">Google Driveと連携</a>
          </Button>
        ) : (
          <>
            {googleEmail && (
              <p className="text-micro">連携中: {googleEmail}</p>
            )}
            {kind === "practice" && inputMode === "new" && (
              <Disclosure
                title="曜日ごとの時間・場所"
                className="border-b border-separator/70"
              >
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1.25fr)] gap-2 px-1">
                    <span />
                    <span className="text-micro">時間</span>
                    <span className="text-micro">場所</span>
                  </div>
                  {weekdayDefaults.map((item) => (
                    <div
                      key={item.weekday}
                      className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1.25fr)] items-center gap-2"
                    >
                      <span className="text-center text-[14px] font-semibold">
                        {WEEKDAYS[item.weekday]}
                      </span>
                      <Input
                        type="time"
                        value={item.time}
                        aria-label={`${WEEKDAYS[item.weekday]}曜日の時間`}
                        onChange={(event) =>
                          updateWeekdayDefault(
                            item.weekday,
                            "time",
                            event.target.value,
                          )
                        }
                      />
                      <select
                        value={item.venueName}
                        aria-label={`${WEEKDAYS[item.weekday]}曜日の場所`}
                        onChange={(event) =>
                          updateWeekdayDefault(
                            item.weekday,
                            "venueName",
                            event.target.value,
                          )
                        }
                        className="h-11 min-w-0 w-full rounded-xl border border-separator bg-card px-2 text-[14px] outline-none"
                      >
                        <option value="">未設定</option>
                        {venues.map((venue) => (
                          <option key={venue.id} value={venue.name}>
                            {venue.short || venue.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <p className="px-1 text-micro">
                    空欄の項目はシートでも空欄になります。
                  </p>
                </div>
              </Disclosure>
            )}
            <Button
              type="button"
              size="lg"
              disabled={issuing || googleConnected === null}
              onClick={issueSpreadsheet}
            >
              {issuing ? "発行中..." : "シートを発行"}
            </Button>
          </>
        )}
        {sheetUrl && (
          <Button type="button" variant="outline" size="lg" asChild>
            <a href={sheetUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={17} />
              発行したシートを開く
            </a>
          </Button>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Step number={2} />
          <p className="text-headline">CSVで作る場合</p>
        </div>
        <p className="text-caption">
          {kind === "practice"
            ? inputMode === "edit"
              ? "選択した練習予定の内容入りCSVを出力します。編集後にアップロードすると更新されます。"
              : "選んだ月の日付と曜日が入力済みです。Googleスプレッドシートで予定を入力してください。"
            : inputMode === "edit"
              ? "選択した予定の内容と予定ID入りCSVを出力します。日付や名称を変えても同じ予定を更新できます。"
              : `${kind === "meet" ? "大会名" : "記録会名"}・開始日・終了日・エントリー開始日・締切日を入力します。`}
        </p>
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={inputMode === "edit" && selectedIds.length === 0}
          onClick={downloadTemplate}
        >
          <Download size={17} />
          {inputMode === "edit" ? "選択した予定をCSV出力" : "テンプレートCSV"}
        </Button>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Step number={3} />
          <p className="text-headline">入力した予定を読み込む</p>
        </div>
        <SegmentedControl
          items={[
            { key: "url", label: "スプレッドシートURL" },
            { key: "file", label: "CSVファイル" },
          ]}
          value={source}
          onChange={(value) => {
            setSource(value);
            setPreview(null);
            setSheetId(null);
            setError(null);
          }}
        />
        {source === "url" ? (
          <div className="space-y-2">
            <div className="relative">
              <Link2
                size={18}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
              />
              <Input
                type="url"
                value={sheetUrl}
                onChange={(event) => {
                  setSheetUrl(event.target.value);
                  setSheetId(null);
                  setPreview(null);
                }}
                placeholder="Googleスプレッドシートの共有URL"
                className="pl-10"
              />
            </div>
            <p className="text-micro">
              共有設定を「リンクを知っている全員が閲覧可」にしてください。通常の編集画面URLをそのまま貼れます。
            </p>
          </div>
        ) : (
          <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-separator bg-card px-4 active:bg-bg">
            <Upload size={19} className="text-accent" />
            <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
              {fileName || "CSVファイルを選択"}
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => void selectFile(event.target.files?.[0])}
            />
          </label>
        )}
        <Button
          size="lg"
          disabled={
            loading ||
            (source === "url" ? !sheetUrl.trim() : !csv)
          }
          onClick={previewImport}
        >
          {loading ? "確認中..." : "内容を確認"}
        </Button>
      </section>

      {preview && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Step number={4} />
            <p className="text-headline">確認して予定へ反映</p>
          </div>
          <PreviewSection title="追加予定" rows={preview.additions} />
          <PreviewSection title="更新予定" rows={preview.updates} />
          <SimpleSection
            title="削除候補（削除しません）"
            items={preview.deletions.map(
              (row) => `${row.schedule_date} ${row.title || row.venue_name || "予定"}`,
            )}
          />
          <SimpleSection
            title="エラー行"
            danger
            items={preview.errors.map(
              (row) => `${row.rowNumber}行目: ${row.message}`,
            )}
          />
          <SimpleSection
            title="スキップ行"
            items={preview.skips.map(
              (row) => `${row.rowNumber}行目: ${row.message}`,
            )}
          />
          <Button size="lg" disabled={applying || applicable === 0} onClick={apply}>
            {applying ? "反映中..." : `${applicable}件を予定に反映`}
          </Button>
        </section>
      )}

      {error && <p className="text-center text-caption text-danger">{error}</p>}
    </div>
  );

  function updateWeekdayDefault(
    weekday: number,
    field: "time" | "venueName",
    value: string,
  ) {
    setWeekdayDefaults((items) =>
      items.map((item) =>
        item.weekday === weekday ? { ...item, [field]: value } : item,
      ),
    );
  }
}

function Step({ number }: { number: number }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-white">
      {number}
    </span>
  );
}

function PreviewSection({
  title,
  rows,
}: {
  title: string;
  rows: ScheduleImportRow[];
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="section-label">{title}</p>
        <Badge>{rows.length}件</Badge>
      </div>
      {rows.length > 0 && (
        <Card className="space-y-2 p-3">
          {rows.map((row) => (
            <div
              key={`${title}-${row.rowNumber}`}
              className="border-b border-separator pb-2 last:border-b-0 last:pb-0"
            >
              <p className="text-[13px] font-semibold">
                {row.schedule_date} {row.title || row.venue_name || "予定"}
              </p>
              <p className="text-micro">
                {row.rowNumber}行目
                {row.end_date ? ` / 終了 ${row.end_date}` : ""}
                {row.meeting_time ? ` / ${row.meeting_time}` : ""}
              </p>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

function SimpleSection({
  title,
  items,
  danger = false,
}: {
  title: string;
  items: string[];
  danger?: boolean;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="section-label">{title}</p>
        <Badge>{items.length}件</Badge>
      </div>
      {items.length > 0 && (
        <Card className="space-y-1 p-3">
          {items.map((item) => (
            <p key={item} className={danger ? "text-caption text-danger" : "text-caption"}>
              {item}
            </p>
          ))}
        </Card>
      )}
    </section>
  );
}

function createTemplateRows(
  year: number,
  month: number,
  kind: ScheduleSheetKind,
  block: ScheduleSheetBlock,
): Record<string, string>[] {
  const days = new Date(year, month, 0).getDate();
  const blockName = block === "all" ? "全体" : BLOCKS[block].label;
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  if (kind !== "practice") {
    return Array.from({ length: 10 }, () => ({
      [kind === "meet" ? "大会名" : "記録会名"]: "",
      "開始日": "",
      "終了日": "",
      "エントリー開始日": "",
      "エントリー締切日": "",
    }));
  }
  return Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const date = new Date(year, month - 1, day);
    const base = {
      "日付": `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      "曜日": weekdays[date.getDay()],
    };
    return {
      ...base,
      "対象ブロック": blockName,
      "時間": "",
      "場所": "",
      "詳細": "",
    };
  });
}

function createExistingRows(
  schedules: PracticeSchedule[],
  kind: ScheduleSheetKind,
  block: ScheduleSheetBlock,
): Record<string, string>[] {
  const blockName = block === "all" ? "全体" : BLOCKS[block].label;
  if (kind === "practice") {
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    return schedules.map((schedule) => ({
      "予定ID": schedule.id,
      "日付": schedule.schedule_date,
      "曜日": weekdays[new Date(`${schedule.schedule_date}T00:00:00`).getDay()],
      "対象ブロック": blockName,
      "時間": schedule.meeting_time?.slice(0, 5) ?? "",
      "場所": schedule.venue_name ?? "",
      "詳細": schedule.note ?? "",
    }));
  }
  const titleKey = kind === "meet" ? "大会名" : "記録会名";
  return schedules.map((schedule) => ({
    "予定ID": schedule.id,
    [titleKey]: schedule.title ?? "",
    "開始日": schedule.schedule_date,
    "終了日": schedule.end_date ?? "",
    "エントリー開始日": schedule.entry_start ?? "",
    "エントリー締切日": schedule.entry_end ?? "",
  }));
}

function toRpcRow(row: ScheduleImportRow) {
  return {
    id: row.id ?? "",
    schedule_date: row.schedule_date,
    end_date: row.end_date ?? "",
    meeting_time: row.meeting_time ?? "",
    venue_name: row.venue_name ?? "",
    venue_access: row.venue_access ?? "",
    venue_fee: row.venue_fee ?? "",
    venue_url: row.venue_url ?? "",
    title: row.title ?? "",
    entry_start: row.entry_start ?? "",
    entry_end: row.entry_end ?? "",
    note: row.note ?? "",
    target_blocks: row.target_blocks,
  };
}
