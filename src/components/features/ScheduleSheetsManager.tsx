"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileSpreadsheet, Plus, RefreshCw, Upload } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { createClient } from "@/lib/supabase/client";
import { BLOCKS } from "@/lib/constants";
import type {
  ScheduleImportPreview,
  ScheduleImportRow,
  ScheduleSheet,
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
  const [sheets, setSheets] = useState<ScheduleSheet[] | null>(null);
  const [editing, setEditing] = useState<ScheduleSheet | "new" | null>(null);
  const [previewSheet, setPreviewSheet] = useState<ScheduleSheet | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("schedule_sheets")
      .select("*")
      .eq("status", "active")
      .order("target_year", { ascending: false })
      .order("target_month", { ascending: false })
      .order("created_at", { ascending: false });
    setSheets((data ?? []) as ScheduleSheet[]);
  }, []);

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void supabase
      .from("schedule_sheets")
      .select("*")
      .eq("status", "active")
      .order("target_year", { ascending: false })
      .order("target_month", { ascending: false })
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (active) setSheets((data ?? []) as ScheduleSheet[]);
      });
    return () => {
      active = false;
    };
  }, []);

  async function remove(sheet: ScheduleSheet) {
    const supabase = createClient();
    const { error } = await supabase.from("schedule_sheets").delete().eq("id", sheet.id);
    if (error) return false;
    setSheets((items) => items?.filter((item) => item.id !== sheet.id) ?? []);
    return true;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="section-label">登録済みシート</p>
          <p className="text-micro mt-0.5">公開CSVは確認後に予定へ反映されます。</p>
        </div>
        <Button type="button" size="sm" onClick={() => setEditing("new")}>
          <Plus size={16} />
          作成
        </Button>
      </div>

      {sheets === null ? (
        <div className="space-y-2">
          {[0, 1].map((item) => (
            <Skeleton key={item} className="h-28 w-full" />
          ))}
        </div>
      ) : sheets.length === 0 ? (
        <EmptyState
          title="登録済みのシートはありません"
          description="Googleスプレッドシートを公開CSVとして登録します。"
        />
      ) : (
        <div className="space-y-2">
          {sheets.map((sheet) => (
            <Card key={sheet.id} className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <FileSpreadsheet size={21} className="mt-0.5 shrink-0 text-success" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <p className="text-headline">
                      {sheet.target_year}年{sheet.target_month}月
                    </p>
                    <Badge>{sheet.kind === "practice" ? "練習予定" : "記録会"}</Badge>
                    <Badge>{blockLabel(sheet.target_block)}</Badge>
                  </div>
                  <p className="mt-1 text-micro">
                    {sheet.last_imported_at
                      ? `${new Date(sheet.last_imported_at).toLocaleString("ja-JP")} 取込`
                      : "未取込"}
                  </p>
                </div>
                <ActionMenu
                  onEdit={() => setEditing(sheet)}
                  onDelete={() => remove(sheet)}
                  deleteTitle="シート登録を削除しますか？"
                  deleteDescription="シート由来の予定は削除されません。"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" asChild>
                  <a href={sheet.sheet_url} target="_blank" rel="noreferrer">
                    <ExternalLink size={16} />
                    開く
                  </a>
                </Button>
                <Button
                  type="button"
                  disabled={!sheet.csv_url}
                  onClick={() => setPreviewSheet(sheet)}
                >
                  <Upload size={16} />
                  インポート
                </Button>
              </div>
              <Button type="button" variant="secondary" size="lg" disabled>
                シートへ反映（準備中）
              </Button>
            </Card>
          ))}
        </div>
      )}

      <Card className="space-y-2 p-4">
        <p className="text-headline">テンプレート</p>
        <p className="text-caption">
          練習予定: 日付 / 曜日 / 対象ブロック / 時間 / 場所 / 詳細
        </p>
        <p className="text-caption">
          記録会: 日付 / 曜日 / 記録会名 / 場所 / エントリー開始日 /
          エントリー締切日 / 対象ブロック / 詳細
        </p>
        <Button type="button" variant="outline" asChild>
          <a href="https://sheets.new" target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            新しいスプレッドシートを開く
          </a>
        </Button>
      </Card>

      {editing && (
        <FormModal
          open
          onOpenChange={(open) => !open && setEditing(null)}
          title={editing === "new" ? "シートを登録" : "シートを編集"}
        >
          <ScheduleSheetForm
            sheet={editing === "new" ? undefined : editing}
            existing={sheets ?? []}
            onDone={() => {
              setEditing(null);
              void load();
            }}
          />
        </FormModal>
      )}

      {previewSheet && (
        <FormModal
          open
          onOpenChange={(open) => !open && setPreviewSheet(null)}
          title="インポート内容を確認"
        >
          <ScheduleImportConfirmation
            sheet={previewSheet}
            onDone={() => {
              setPreviewSheet(null);
              void load();
            }}
          />
        </FormModal>
      )}
    </div>
  );
}

function ScheduleSheetForm({
  sheet,
  existing,
  onDone,
}: {
  sheet?: ScheduleSheet;
  existing: ScheduleSheet[];
  onDone: () => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(sheet?.target_year ?? now.getFullYear());
  const [month, setMonth] = useState(sheet?.target_month ?? now.getMonth() + 1);
  const [kind, setKind] = useState<ScheduleSheetKind>(sheet?.kind ?? "practice");
  const [block, setBlock] = useState<ScheduleSheetBlock>(sheet?.target_block ?? "all");
  const [sheetUrl, setSheetUrl] = useState(sheet?.sheet_url ?? "");
  const [csvUrl, setCsvUrl] = useState(sheet?.csv_url ?? "");
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function hasDuplicate() {
    return existing.some(
      (item) =>
        item.id !== sheet?.id &&
        item.target_year === year &&
        item.target_month === month &&
        item.kind === kind &&
        item.target_block === block,
    );
  }

  async function submit(force = false) {
    if (!sheetUrl.trim()) {
      setError("編集用URLを入力してください");
      return;
    }
    if (!force && hasDuplicate()) {
      setDuplicateOpen(true);
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
    const payload = {
      target_year: year,
      target_month: month,
      kind,
      target_block: block,
      sheet_url: sheetUrl.trim(),
      csv_url: csvUrl.trim() || null,
    };
    const { error: saveError } = sheet
      ? await supabase.from("schedule_sheets").update(payload).eq("id", sheet.id)
      : await supabase
          .from("schedule_sheets")
          .insert({ ...payload, author_id: user.id });
    if (saveError) {
      setError("シートを保存できませんでした");
      setSaving(false);
      return;
    }
    onDone();
  }

  return (
    <div className="space-y-5 pb-4">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="section-label mb-1.5">年</p>
          <Input
            type="number"
            min={2020}
            max={2100}
            value={year}
            onChange={(event) => setYear(Number(event.target.value))}
          />
        </div>
        <div>
          <p className="section-label mb-1.5">月</p>
          <Input
            type="number"
            min={1}
            max={12}
            value={month}
            onChange={(event) => setMonth(Number(event.target.value))}
          />
        </div>
      </div>

      <div>
        <p className="section-label mb-1.5">種類</p>
        <SegmentedControl
          items={[
            { key: "practice", label: "練習予定" },
            { key: "meet", label: "記録会" },
          ]}
          value={kind}
          onChange={setKind}
        />
      </div>

      <div>
        <p className="section-label mb-1.5">対象ブロック</p>
        <select
          value={block}
          onChange={(event) => setBlock(event.target.value as ScheduleSheetBlock)}
          className="h-11 w-full rounded-xl border border-separator bg-card px-3 text-[15px] outline-none"
        >
          {BLOCK_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="section-label mb-1.5">編集用URL</p>
        <Input
          type="url"
          value={sheetUrl}
          onChange={(event) => setSheetUrl(event.target.value)}
          placeholder="https://docs.google.com/spreadsheets/..."
        />
      </div>

      <div>
        <p className="section-label mb-1.5">公開CSV URL</p>
        <Input
          type="url"
          value={csvUrl}
          onChange={(event) => setCsvUrl(event.target.value)}
          placeholder="https://docs.google.com/.../pub?output=csv"
        />
        <p className="mt-1 text-micro">
          Googleスプレッドシートの「ウェブに公開」でCSVを選択したURLです。
        </p>
      </div>

      {error && <p className="text-center text-caption text-danger">{error}</p>}
      <Button size="lg" disabled={saving} onClick={() => submit()}>
        {saving ? "保存中..." : "保存する"}
      </Button>

      <ConfirmDialog
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
        title="同じ範囲のシートがあります"
        description="同じ年月・種類・ブロックのシートを重複して登録しますか？"
        confirmLabel="登録する"
        busy={saving}
        onConfirm={() => {
          setDuplicateOpen(false);
          void submit(true);
        }}
      />
    </div>
  );
}

function ScheduleImportConfirmation({
  sheet,
  onDone,
}: {
  sheet: ScheduleSheet;
  onDone: () => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<ScheduleImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const loadPreview = useCallback(async () => {
    setPreview(null);
    setError(null);
    const response = await fetch("/api/schedule-sheets/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetId: sheet.id }),
    });
    const result = await response.json();
    if (!response.ok) {
      setError(result.error ?? "CSVを確認できませんでした");
      return;
    }
    setPreview(result as ScheduleImportPreview);
  }, [sheet.id]);

  useEffect(() => {
    let active = true;
    void fetch("/api/schedule-sheets/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetId: sheet.id }),
    })
      .then(async (response) => ({
        ok: response.ok,
        result: await response.json(),
      }))
      .then(({ ok, result }) => {
        if (!active) return;
        if (!ok) {
          setError(result.error ?? "CSVを確認できませんでした");
          return;
        }
        setPreview(result as ScheduleImportPreview);
      });
    return () => {
      active = false;
    };
  }, [sheet.id]);

  async function apply() {
    if (!preview || applying) return;
    setApplying(true);
    setError(null);
    const rows = [...preview.additions, ...preview.updates].map(toRpcRow);
    const supabase = createClient();
    const { error: applyError } = await supabase.rpc("apply_schedule_sheet_import", {
      target_sheet_id: sheet.id,
      import_rows: rows,
    });
    if (applyError) {
      setError("予定へ反映できませんでした");
      setApplying(false);
      return;
    }
    router.refresh();
    onDone();
  }

  if (error && !preview) {
    return (
      <div className="space-y-4">
        <EmptyState title="CSVを読み込めませんでした" description={error} />
        <Button size="lg" variant="outline" onClick={loadPreview}>
          <RefreshCw size={17} />
          再読み込み
        </Button>
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  const applicable = preview.additions.length + preview.updates.length;
  return (
    <div className="space-y-5 pb-4">
      <PreviewSection title="追加予定" count={preview.additions.length}>
        {preview.additions.map((row) => (
          <PreviewRow key={`add-${row.rowNumber}`} row={row} />
        ))}
      </PreviewSection>
      <PreviewSection title="更新予定" count={preview.updates.length}>
        {preview.updates.map((row) => (
          <PreviewRow key={`update-${row.rowNumber}`} row={row} />
        ))}
      </PreviewSection>
      <PreviewSection title="削除候補（削除しません）" count={preview.deletions.length}>
        {preview.deletions.map((row) => (
          <p key={row.id} className="text-caption">
            {row.schedule_date} {row.title || row.venue_name || "予定"}
          </p>
        ))}
      </PreviewSection>
      <PreviewSection title="エラー行" count={preview.errors.length}>
        {preview.errors.map((row) => (
          <p key={`error-${row.rowNumber}`} className="text-caption text-danger">
            {row.rowNumber}行目: {row.message}
          </p>
        ))}
      </PreviewSection>
      <PreviewSection title="スキップ行" count={preview.skips.length}>
        {preview.skips.map((row) => (
          <p key={`skip-${row.rowNumber}`} className="text-caption">
            {row.rowNumber}行目: {row.message}
          </p>
        ))}
      </PreviewSection>

      {error && <p className="text-center text-caption text-danger">{error}</p>}
      <Button size="lg" disabled={applying || applicable === 0} onClick={apply}>
        {applying ? "反映中..." : `${applicable}件を予定に反映`}
      </Button>
    </div>
  );
}

function PreviewSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="section-label">{title}</p>
        <Badge>{count}件</Badge>
      </div>
      {count > 0 && <Card className="space-y-2 p-3">{children}</Card>}
    </section>
  );
}

function PreviewRow({ row }: { row: ScheduleImportRow }) {
  return (
    <div className="border-b border-separator pb-2 last:border-b-0 last:pb-0">
      <p className="text-[13px] font-semibold">
        {row.schedule_date} {row.title || row.venue_name || "予定"}
      </p>
      <p className="text-micro">
        {row.rowNumber}行目
        {row.meeting_time ? ` / ${row.meeting_time}` : ""}
      </p>
    </div>
  );
}

function toRpcRow(row: ScheduleImportRow) {
  return {
    id: row.id ?? "",
    schedule_date: row.schedule_date,
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

function blockLabel(block: ScheduleSheetBlock): string {
  if (block === "all") return "全体";
  return BLOCKS[block].label;
}
