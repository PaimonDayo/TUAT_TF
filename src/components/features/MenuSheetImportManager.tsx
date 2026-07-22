"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { AlertCircle, Download, Link2, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { MENU_IMPORT_COLUMNS } from "@/lib/menu-import";
import { BLOCK_ORDER, BLOCKS } from "@/lib/constants";
import type {
  Block,
  MenuImportEditableRow,
  MenuImportPreview,
} from "@/types";

const BLOCK_OPTIONS = BLOCK_ORDER.map((block) => ({
  value: block,
  label: BLOCKS[block].label,
}));

export function MenuSheetImportManager() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [targetBlock, setTargetBlock] = useState<Block>("middle_long");
  const [status, setStatus] = useState<"draft" | "published">("published");
  const [source, setSource] = useState<"url" | "file">("url");
  const [sheetUrl, setSheetUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<MenuImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function downloadTemplate() {
    const rows = [
      {
        "日付": `${year}-${String(now.getMonth() + 1).padStart(2, "0")}-01`,
        "対象ブロック": BLOCKS[targetBlock].label,
        "メニュー": "",
        "ペース": "",
        "補足": "",
        "補強": "",
      },
    ];
    const content = `\uFEFF${Papa.unparse(rows)}`;
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `menu-${year}-${targetBlock}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function selectFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    setCsv(await file.text());
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
    const response = await fetch("/api/menu-sheets/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year,
        targetBlock,
        sheetUrl: source === "url" ? sheetUrl.trim() : undefined,
        csv: source === "file" ? csv : undefined,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "CSVを確認できませんでした");
      setLoading(false);
      return;
    }
    setPreview(result as MenuImportPreview);
    setLoading(false);
  }

  async function validateEditedRows(
    rows: MenuImportEditableRow[],
  ): Promise<MenuImportPreview | null> {
    setLoading(true);
    setError(null);
    const response = await fetch("/api/menu-sheets/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        year,
        targetBlock,
        rows: rows.map(({ rowNumber, values }) => ({ rowNumber, values })),
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "入力内容を再確認できませんでした");
      setLoading(false);
      return null;
    }
    const next = result as MenuImportPreview;
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

  async function apply() {
    if (!preview || applying) return;
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
    const supabase = createClient();
    const failedRowNumbers = new Set<number>();
    for (const row of validRows) {
      const { error: saveError } = await supabase.rpc("save_practice_menu", {
        target_schedule_id: row.scheduleId,
        menu_content: row.content,
        menu_status: status,
        menu_target_block: row.targetBlock,
        target_user_ids: [],
        target_menu_id: row.existingMenuId ?? undefined,
        menu_pace: row.pace ?? undefined,
        menu_remark: row.remark ?? undefined,
        menu_supplement: row.supplement ?? undefined,
      });
      if (saveError) failedRowNumbers.add(row.rowNumber);
    }
    router.refresh();
    if (failedRowNumbers.size > 0) {
      setPreview({
        ...validated,
        rows: validated.rows.filter((row) => failedRowNumbers.has(row.rowNumber)),
        additions: [],
        updates: [],
      });
      setError(`${failedRowNumbers.size}件の反映に失敗しました`);
    } else {
      setPreview(null);
      setCsv("");
      setFileName("");
      setSheetUrl("");
    }
    setApplying(false);
  }

  const applicable = preview
    ? preview.rows.filter((row) => row.status === "addition" || row.status === "update").length
    : 0;
  const errorCount = preview
    ? preview.rows.filter((row) => row.status === "error").length
    : 0;
  const dirtyCount = preview
    ? preview.rows.filter((row) => row.status === "editing").length
    : 0;

  return (
    <div className="space-y-5 pb-4">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Step number={1} />
          <p className="text-headline">対象年とブロックを選ぶ</p>
        </div>
        <p className="text-caption">
          日付に対応する予定（時間・場所）が先に登録されている必要があります。メニューだけを一括で入力・更新します。
        </p>
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
            }}
          />
          <Select
            value={targetBlock}
            onValueChange={(value) => {
              setTargetBlock(value as Block);
              setPreview(null);
            }}
            ariaLabel="対象ブロック"
            options={BLOCK_OPTIONS}
          />
        </div>
        <div>
          <p className="section-label mb-1.5">公開状態</p>
          <SegmentedControl
            items={[
              { key: "draft", label: "下書き" },
              { key: "published", label: "公開" },
            ]}
            value={status}
            onChange={(key) => setStatus(key as "draft" | "published")}
          />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Step number={2} />
          <p className="text-headline">CSVで作る場合</p>
        </div>
        <p className="text-caption">
          列: 日付 / 対象ブロック(省略可) / メニュー / ペース / 補足 / 補強。ペース・補足・補強は中長距離向けの枠です。
        </p>
        <Button type="button" variant="outline" size="lg" onClick={downloadTemplate}>
          <Download size={17} />
          テンプレートCSV
        </Button>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Step number={3} />
          <p className="text-headline">入力したメニューを読み込む</p>
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
                  setPreview(null);
                }}
                placeholder="Googleスプレッドシートの共有URL"
                className="pl-10"
              />
            </div>
            <p className="text-micro">
              共有設定を「リンクを知っている全員が閲覧可」にしてください。
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
          disabled={loading || (source === "url" ? !sheetUrl.trim() : !csv)}
          onClick={previewImport}
        >
          {loading ? "確認中..." : "内容を確認"}
        </Button>
      </section>

      {preview && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Step number={4} />
            <p className="text-headline">確認してメニューへ反映</p>
          </div>
          <Card className="grid grid-cols-3 divide-x divide-separator overflow-hidden">
            <SummaryCount label="取込可能" value={applicable} />
            <SummaryCount label="エラー" value={errorCount} danger={errorCount > 0} />
            <SummaryCount label="未確認" value={dirtyCount} />
          </Card>
          <EditablePreviewTable rows={preview.rows} onChange={updatePreviewCell} />
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
          <Button
            size="lg"
            disabled={applying || preview.rows.length === 0 || (applicable === 0 && dirtyCount === 0)}
            onClick={apply}
          >
            {applying
              ? "反映中..."
              : dirtyCount > 0
                ? "再確認して正常行を反映"
                : `${applicable}件をメニューに反映`}
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
}

function Step({ number }: { number: number }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-white">
      {number}
    </span>
  );
}

function EditablePreviewTable({
  rows,
  onChange,
}: {
  rows: MenuImportEditableRow[];
  onChange: (rowNumber: number, column: string, value: string) => void;
}) {
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
              {MENU_IMPORT_COLUMNS.map((column) => (
                <th key={column} className="min-w-32 px-2 py-2 text-micro">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.rowNumber} className="border-b border-separator/70 last:border-b-0">
                <td className="sticky left-0 z-10 bg-card px-2 py-2 align-top">
                  <p className="text-micro">{row.rowNumber}行</p>
                  <RowStatus row={row} />
                </td>
                {MENU_IMPORT_COLUMNS.map((column) => (
                  <td key={column} className="px-1.5 py-1.5 align-top">
                    {column === "メニュー" || column === "ペース" || column === "補足" || column === "補強" ? (
                      <textarea
                        value={row.values[column] ?? ""}
                        aria-label={`${row.rowNumber}行目 ${column}`}
                        rows={2}
                        onChange={(event) => onChange(row.rowNumber, column, event.target.value)}
                        className="w-full min-w-40 rounded-lg border border-separator bg-white px-2 py-1.5 text-[16px] outline-none focus:border-accent"
                      />
                    ) : (
                      <input
                        type={column === "日付" ? "date" : "text"}
                        value={row.values[column] ?? ""}
                        aria-label={`${row.rowNumber}行目 ${column}`}
                        onChange={(event) => onChange(row.rowNumber, column, event.target.value)}
                        className="h-9 w-full min-w-32 rounded-lg border border-separator bg-white px-2 text-[16px] outline-none focus:border-accent"
                      />
                    )}
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

function RowStatus({ row }: { row: MenuImportEditableRow }) {
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
      <p className={`mt-0.5 text-title tabular-nums ${danger ? "text-danger" : ""}`}>{value}</p>
    </div>
  );
}
