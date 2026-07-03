"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import {
  AlertCircle,
  Check,
  Download,
  ExternalLink,
  Link2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { BLOCKS, SCHEDULE_TYPE_OPTIONS } from "@/lib/constants";
import type {
  ScheduleImportPreview,
  ScheduleImportEditableRow,
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
  const [lastApplied, setLastApplied] = useState<PracticeSchedule[]>([]);
  const [undoing, setUndoing] = useState(false);
  const [deletionIds, setDeletionIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);

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
      const filteredExisting = ((data ?? []) as PracticeSchedule[]).filter(
        (schedule) =>
          [...(schedule.target_blocks ?? [])].sort().join(",") ===
          [...targetBlocks].sort().join(","),
      );
      setExisting(filteredExisting);
      // 既存を編集は「全選択スタート」。必要な人だけ外す運用にする。
      setSelectedIds(filteredExisting.map((schedule) => schedule.id));
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
    setDeletionIds((result as ScheduleImportPreview).deletions.map((row) => row.id));
    setLoading(false);
  }

  async function apply() {
    if (!preview || !sheetId || applying) return;
    setApplying(true);
    setError(null);
    const validated = await validateEditedRows(preview.rows);
    if (!validated) {
      setApplying(false);
      return;
    }
    const validRows = [...validated.additions, ...validated.updates];
    if (validRows.length === 0) {
      setPreview(validated);
      setApplying(false);
      return;
    }
    const rows = validRows.map(toRpcRow);
    const supabase = createClient();
    const beforeApply = new Date().toISOString();
    const { error: applyError } = await supabase.rpc("apply_schedule_sheet_import", {
      target_sheet_id: sheetId,
      import_rows: rows,
    });
    if (applyError) {
      setError("予定へ反映できませんでした");
      setApplying(false);
      return;
    }
    // 直前の取込で新規追加された予定を控えておき、誤登録時にすぐ取り消せるようにする
    const { data: insertedData } = await supabase
      .from("practice_schedules")
      .select("*")
      .eq("source_sheet_id", sheetId)
      .gte("created_at", beforeApply);
    setLastApplied((insertedData ?? []) as PracticeSchedule[]);
    router.refresh();
    const remaining = validated.rows.filter((row) => row.status === "error");
    if (remaining.length > 0) {
      setPreview({
        ...validated,
        rows: remaining,
        additions: [],
        updates: [],
        deletions: [],
      });
    } else {
      setPreview(null);
      setCsv("");
      setFileName("");
      setSheetUrl("");
      setSheetId(null);
    }
    setApplying(false);
  }

  async function undoLastApply() {
    if (lastApplied.length === 0 || undoing) return;
    setUndoing(true);
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("practice_schedules")
      .delete()
      .in("id", lastApplied.map((schedule) => schedule.id));
    if (deleteError) {
      setError("取り消しに失敗しました");
      setUndoing(false);
      return;
    }
    setLastApplied([]);
    router.refresh();
    setUndoing(false);
  }

  async function deleteSelectedCandidates() {
    if (deletionIds.length === 0 || deleting) return;
    setDeleting(true);
    setError(null);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("practice_schedules")
      .delete()
      .in("id", deletionIds);
    if (deleteError) {
      setError("削除に失敗しました");
      setDeleting(false);
      return;
    }
    setPreview((current) =>
      current
        ? {
            ...current,
            deletions: current.deletions.filter((row) => !deletionIds.includes(row.id)),
          }
        : current,
    );
    setDeletionIds([]);
    router.refresh();
    setDeleting(false);
  }

  async function validateEditedRows(
    rows: ScheduleImportEditableRow[],
  ): Promise<ScheduleImportPreview | null> {
    if (!sheetId) return null;
    setLoading(true);
    setError(null);
    const response = await fetch("/api/schedule-sheets/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sheetId,
        rows: rows.map(({ rowNumber, values }) => ({ rowNumber, values })),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "入力内容を再確認できませんでした");
      setLoading(false);
      return null;
    }
    const next = {
      ...(result as ScheduleImportPreview),
      deletions: preview?.deletions ?? [],
    };
    setPreview(next);
    setLoading(false);
    return next;
  }

  function updatePreviewCell(rowNumber: number, column: string, value: string) {
    setPreview((current) => {
      if (!current) return current;
      return {
        ...current,
        rows: current.rows.map((row) =>
          row.rowNumber === rowNumber
            ? {
                ...row,
                values: { ...row.values, [column]: value },
                status: "editing",
                message: "未確認の変更があります",
                normalized: null,
              }
            : row,
        ),
      };
    });
  }

  const applicable = preview
    ? preview.rows.filter(
        (row) => row.status === "addition" || row.status === "update",
      ).length
    : 0;
  const errorCount = preview
    ? preview.rows.filter((row) => row.status === "error").length
    : 0;
  const dirtyCount = preview
    ? preview.rows.filter((row) => row.status === "editing").length
    : 0;

  return (
    <div className="space-y-5 pb-4">
      {lastApplied.length > 0 && (
        <Card className="space-y-2 border-danger/30 bg-danger/5 p-3">
          <p className="text-caption">
            直前の取込で{lastApplied.length}件の予定を追加しました。間違えた場合はここから取り消せます。
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={undoing}
            onClick={undoLastApply}
            className="border-danger text-danger"
          >
            {undoing ? "取り消し中..." : `この取込を取り消す（${lastApplied.length}件削除）`}
          </Button>
        </Card>
      )}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Step number={1} />
          <p className="text-headline">入力する予定の種類を選ぶ</p>
        </div>
        <SegmentedControl
          items={SCHEDULE_TYPE_OPTIONS.map((option) => ({
            key: option.key,
            label: option.label,
          }))}
          value={kind}
          onChange={(value) => {
            setKind(value as ScheduleSheetKind);
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
        <Select
          value={block}
          onValueChange={(value) => {
            setBlock(value as ScheduleSheetBlock);
            setPreview(null);
            setSheetId(null);
          }}
          ariaLabel="対象ブロック"
          options={BLOCK_OPTIONS}
        />
        <SegmentedControl
          items={[
            { key: "new", label: "新しく入力" },
            { key: "edit", label: "既存を編集" },
          ]}
          value={inputMode}
          onChange={(value) => {
            setInputMode(value);
            // 編集は全選択スタート / 新規は選択なし
            setSelectedIds(value === "edit" ? existing.map((s) => s.id) : []);
          }}
        />
        {inputMode === "edit" && existing.length > 0 && (
          <div className="flex items-center justify-between px-1">
            <span className="text-caption tabular-nums">
              {selectedIds.length} / {existing.length} 件を編集対象
            </span>
            <button
              type="button"
              onClick={() =>
                setSelectedIds(
                  selectedIds.length === existing.length
                    ? []
                    : existing.map((s) => s.id),
                )
              }
              className="text-[13px] font-semibold text-accent active:opacity-60"
            >
              {selectedIds.length === existing.length ? "すべて解除" : "すべて選択"}
            </button>
          </div>
        )}
        {inputMode === "edit" && (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-separator bg-card p-1">
            {existing.length === 0 ? (
              <EmptyState title="該当する予定がありません" className="min-h-24 py-4" />
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
          <form action="/api/google/connect" method="post">
            <Button type="submit" size="lg">
              Google Driveと連携
            </Button>
          </form>
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
                      <Select
                        value={item.venueName}
                        ariaLabel={`${WEEKDAYS[item.weekday]}曜日の場所`}
                        onValueChange={(value) =>
                          updateWeekdayDefault(
                            item.weekday,
                            "venueName",
                            value,
                          )
                        }
                        className="px-2 text-[14px]"
                        options={[
                          { value: "", label: "未設定" },
                          ...venues.map((venue) => ({
                            value: venue.name,
                            label: venue.short || venue.name,
                          })),
                        ]}
                      />
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
          <Card className="grid grid-cols-3 divide-x divide-separator overflow-hidden">
            <SummaryCount label="取込可能" value={applicable} />
            <SummaryCount label="エラー" value={errorCount} danger={errorCount > 0} />
            <SummaryCount label="未確認" value={dirtyCount} />
          </Card>
          <EditablePreviewTable
            columns={preview.columns}
            rows={preview.rows}
            onChange={updatePreviewCell}
          />
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={loading}
            onClick={() => void validateEditedRows(preview.rows)}
          >
            <RefreshCw size={17} />
            {loading ? "再確認中..." : "編集内容を再確認"}
          </Button>
          {preview.deletions.length > 0 && (
            <DeletionCandidates
              deletions={preview.deletions}
              selectedIds={deletionIds}
              onChange={setDeletionIds}
              onDelete={deleteSelectedCandidates}
              deleting={deleting}
            />
          )}
          <Button
            size="lg"
            disabled={
              applying ||
              preview.rows.length === 0 ||
              (applicable === 0 && dirtyCount === 0)
            }
            onClick={apply}
          >
            {applying
              ? "反映中..."
              : dirtyCount > 0
                ? "再確認して正常行を反映"
                : `${applicable}件を予定に反映`}
          </Button>
          {errorCount > 0 && (
            <p className="text-caption text-danger">
              エラー行は反映せず画面に残ります。正常行だけ先に反映できます。
            </p>
          )}
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

function EditablePreviewTable({
  columns,
  rows,
  onChange,
}: {
  columns: string[];
  rows: ScheduleImportEditableRow[];
  onChange: (rowNumber: number, column: string, value: string) => void;
}) {
  const visibleColumns = columns.filter((column) => column !== "曜日");
  return (
    <section className="space-y-2">
      <p className="section-label">取込内容を編集</p>
      <div className="overflow-x-auto rounded-xl border border-separator bg-card">
        <table className="w-max min-w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-separator bg-bg">
              <th className="sticky left-0 z-10 min-w-44 bg-bg px-2 py-2 text-micro">
                行・判定
              </th>
              {visibleColumns.map((column) => (
                <th key={column} className="min-w-32 px-2 py-2 text-micro">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.rowNumber}
                className="border-b border-separator/70 last:border-b-0"
              >
                <td className="sticky left-0 z-10 bg-card px-2 py-2 align-top">
                  <p className="text-micro">{row.rowNumber}行</p>
                  <RowStatus row={row} />
                </td>
                {visibleColumns.map((column) => (
                  <td key={column} className="px-1.5 py-1.5 align-top">
                    <input
                      type={inputTypeForColumn(column)}
                      value={row.values[column] ?? ""}
                      readOnly={column === "予定ID"}
                      aria-label={`${row.rowNumber}行目 ${column}`}
                      onChange={(event) =>
                        onChange(row.rowNumber, column, event.target.value)
                      }
                      className="h-9 w-full min-w-32 rounded-lg border border-separator bg-white px-2 text-[16px] outline-none focus:border-accent read-only:bg-bg read-only:text-muted"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RowStatus({ row }: { row: ScheduleImportEditableRow }) {
  if (row.status === "error") {
    return (
      <div className="mt-1 max-w-40 text-[10px] leading-4 text-danger">
        <span className="inline-flex items-center gap-1 font-semibold">
          <AlertCircle size={12} />
          エラー
        </span>
        <p>{row.message}</p>
      </div>
    );
  }
  const labels = {
    addition: "追加",
    update: "更新",
    skip: "スキップ",
    editing: "未確認",
  } as const;
  return (
    <span className="mt-1 inline-block whitespace-nowrap text-[10px] font-semibold text-muted2">
      {labels[row.status]}
    </span>
  );
}

function SummaryCount({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="p-3 text-center">
      <p className="text-micro">{label}</p>
      <p className={`mt-0.5 text-title tabular-nums ${danger ? "text-danger" : ""}`}>
        {value}
      </p>
    </div>
  );
}

function inputTypeForColumn(column: string) {
  if (
    column === "日付" ||
    column === "開始日" ||
    column === "終了日" ||
    column === "エントリー開始日" ||
    column === "エントリー締切日"
  ) {
    return "date";
  }
  if (column === "時間") return "time";
  return "text";
}

function DeletionCandidates({
  deletions,
  selectedIds,
  onChange,
  onDelete,
  deleting,
}: {
  deletions: PracticeSchedule[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="section-label">シートから消えた予定（選んで削除できます）</p>
        <Badge>{deletions.length}件</Badge>
      </div>
      <Card className="space-y-1 p-1">
        {deletions.map((row) => {
          const checked = selectedIds.includes(row.id);
          return (
            <label
              key={row.id}
              className="flex min-h-11 items-center gap-2 rounded-lg px-2 active:bg-bg"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  onChange(
                    checked
                      ? selectedIds.filter((id) => id !== row.id)
                      : [...selectedIds, row.id],
                  )
                }
                className="h-4 w-4 shrink-0"
              />
              <span className="text-caption text-danger">
                {row.schedule_date} {row.title || row.venue_name || "予定"}
              </span>
            </label>
          );
        })}
      </Card>
      <Button
        type="button"
        variant="outline"
        size="lg"
        disabled={deleting || selectedIds.length === 0}
        onClick={onDelete}
        className="border-danger text-danger"
      >
        {deleting ? "削除中..." : `選択した${selectedIds.length}件を削除`}
      </Button>
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
      "場所": "",
      "エントリー開始日": "",
      "エントリー締切日": "",
      "対象ブロック": blockName,
      "詳細": "",
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
    "場所": schedule.venue_name ?? "",
    "エントリー開始日": schedule.entry_start ?? "",
    "エントリー締切日": schedule.entry_end ?? "",
    "対象ブロック":
      schedule.target_blocks.length === 0
        ? "全体"
        : schedule.target_blocks.map((item) => BLOCKS[item].label).join(","),
    "詳細": schedule.note ?? "",
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
