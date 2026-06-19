"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { Download, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { createClient } from "@/lib/supabase/client";
import { BLOCKS } from "@/lib/constants";
import type {
  ScheduleImportPreview,
  ScheduleImportRow,
  ScheduleSheetBlock,
  ScheduleSheetKind,
} from "@/types";

const BLOCK_OPTIONS: { value: ScheduleSheetBlock; label: string }[] = [
  { value: "all", label: "全体" },
  { value: "middle_long", label: "中長距離" },
  { value: "short", label: "短距離" },
  { value: "jump", label: "跳躍" },
  { value: "throw", label: "投擲" },
];

export function ScheduleSheetsManager() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [kind, setKind] = useState<ScheduleSheetKind>("practice");
  const [block, setBlock] = useState<ScheduleSheetBlock>("all");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ScheduleImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function downloadTemplate() {
    const rows = createTemplateRows(year, month, kind, block);
    const content = `\uFEFF${Papa.unparse(rows)}`;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      kind === "practice"
        ? `${year}-${String(month).padStart(2, "0")}-practice-${block}.csv`
        : `meets-${block}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
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
    if (!csv) {
      setError("編集したCSVファイルを選択してください");
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
          sheet_url: `csv-upload://${fileName || "schedule.csv"}`,
          csv_url: null,
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
      body: JSON.stringify({ sheetId: targetSheetId, csv }),
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
            { key: "meet", label: "記録会" },
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
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Step number={2} />
          <p className="text-headline">テンプレートをダウンロード</p>
        </div>
        <p className="text-caption">
          {kind === "practice"
            ? "選んだ月の日付と曜日が入力済みです。Googleスプレッドシートで予定を入力してください。"
            : "記録会名・開始日・終了日・エントリー開始日・締切日を入力します。1日開催は終了日を空欄にします。"}
        </p>
        <Button type="button" variant="outline" size="lg" onClick={downloadTemplate}>
          <Download size={17} />
          テンプレートCSV
        </Button>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Step number={3} />
          <p className="text-headline">編集したCSVを選ぶ</p>
        </div>
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
        <Button size="lg" disabled={!csv || loading} onClick={previewImport}>
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
  if (kind === "meet") {
    return Array.from({ length: 10 }, () => ({
      "記録会名": "",
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
  };
}
