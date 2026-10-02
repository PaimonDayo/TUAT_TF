"use client";

import { Check, Download, ExternalLink, Link2, RefreshCw, Upload } from "lucide-react";
import { Step, SummaryCount } from "@/components/features/sheet-import/ImportFeedback";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { SCHEDULE_TYPE_OPTIONS } from "@/lib/constants";
import type { ScheduleSheetBlock, ScheduleSheetKind } from "@/types";
import { useScheduleSheetImport } from "./schedule-sheets/useScheduleSheetImport";
import { WEEKDAYS } from "./schedule-sheets/schedule-sheet-data";
import { EditablePreviewTable, DeletionCandidates } from "./schedule-sheets/SchedulePreviewTables";

const BLOCK_OPTIONS: { value: ScheduleSheetBlock; label: string }[] = [
  { value: "all", label: "全体" },
  { value: "middle_long", label: "中長距離" },
  { value: "short", label: "短距離" },
];

export function ScheduleSheetsManager() {
  const {
    year, setYear, month, setMonth, kind,
    setKind, block, setBlock, inputMode, setInputMode,
    existing, selectedIds, setSelectedIds, venues, weekdayDefaults,
    googleConnected, googleEmail, issuing, source, setSource,
    sheetUrl, setSheetUrl, fileName, csv, setSheetId,
    preview, setPreview, loading, applying, error,
    setError, lastApplied, undoing, deletionIds, setDeletionIds,
    deleting, downloadTemplate, issueSpreadsheet, selectFile, previewImport,
    apply, undoLastApply, deleteSelectedCandidates, validateEditedRows, updatePreviewCell,
    applicable, errorCount, dirtyCount, updateWeekdayDefault,
  } = useScheduleSheetImport();

  return (
    <div className="space-y-5 pb-4">
      {lastApplied.length > 0 && (
        <Card data-ui-tone="danger" className="space-y-2 border-danger/30 bg-danger/5 p-3">
          <p className="text-caption">
            直前の取り込みで{lastApplied.length}件の予定を追加しました。間違えた場合はここから取り消せます。
          </p>
          <Button data-ui-tone="danger"
            type="button"
            variant="outline"
            size="lg"
            disabled={undoing}
            onClick={undoLastApply}
            className="border-danger text-danger"
          >
            {undoing ? "取り消し中…" : `この取り込みを取り消す（${lastApplied.length}件削除）`}
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
              data-ui-action
              type="button"
              onClick={() =>
                setSelectedIds(
                  selectedIds.length === existing.length
                    ? []
                    : existing.map((s) => s.id),
                )
              }
              className="text-[13px] font-semibold text-accent pressable"
            >
              {selectedIds.length === existing.length ? "すべて解除" : "すべて選択"}
            </button>
          </div>
        )}
        {inputMode === "edit" && (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-separator bg-card p-1">
            {existing.length === 0 ? (
              <EmptyState title="条件に合う予定はありません" className="min-h-24 py-4" />
            ) : (
              existing.map((schedule) => {
                const active = selectedIds.includes(schedule.id);
                return (
                  <button
                    data-ui-row
                    aria-pressed={active}
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
          <p className="text-headline">Googleスプレッドシートを作る</p>
          <p className="mt-1 text-caption">
            あなたのGoogleドライブに、入力用のシートを作ります。場所と対象ブロックの選択欄もあらかじめ用意します。
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
              {issuing ? "作成中…" : "シートを作る"}
            </Button>
          </>
        )}
        {sheetUrl && (
          <Button type="button" variant="outline" size="lg" asChild>
            <a href={sheetUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={17} />
              作ったシートを開く
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
                placeholder="共有URLを入力"
                className="pl-10"
              />
            </div>
            <p className="text-micro">
              共有設定を「リンクを知っている全員が閲覧可」にしてください。通常の編集画面URLをそのまま貼れます。
            </p>
          </div>
        ) : (
          <label data-ui-choice-row className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-separator bg-card px-4 active:bg-bg">
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
          {loading ? "確認中…" : "内容を確認"}
        </Button>
      </section>

      {preview && (
        <section className="space-y-4">
          <div className="flex items-center gap-2">
            <Step number={4} />
            <p className="text-headline">確認して予定に登録</p>
          </div>
          <Card className="grid grid-cols-3 divide-x divide-separator overflow-hidden">
            <SummaryCount label="取り込み可能" value={applicable} />
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
            {loading ? "再確認中…" : "編集内容を再確認"}
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
              ? "登録中…"
              : dirtyCount > 0
                ? "もう一度確認して、問題のない行を登録"
                : `${applicable}件を予定に登録`}
          </Button>
          {errorCount > 0 && (
            <p className="text-caption text-danger">
              エラーのある行は登録せず画面に残ります。問題のない行だけ先に登録できます。
            </p>
          )}
        </section>
      )}

      {error && <p className="text-center text-caption text-danger">{error}</p>}
    </div>
  );
}
