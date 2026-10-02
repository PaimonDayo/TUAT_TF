import { RowStatus } from "@/components/features/sheet-import/ImportFeedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { PracticeSchedule, ScheduleImportEditableRow } from "@/types";

export function EditablePreviewTable({
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
      <p className="section-label">取り込み内容を編集</p>
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
                      data-ui-field type={inputTypeForColumn(column)}
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

export function DeletionCandidates({
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
              data-ui-choice-row key={row.id}
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
      <Button data-ui-tone="danger"
        type="button"
        variant="outline"
        size="lg"
        disabled={deleting || selectedIds.length === 0}
        onClick={onDelete}
        className="border-danger text-danger"
      >
        {deleting ? "削除中…" : `選択した${selectedIds.length}件を削除`}
      </Button>
    </section>
  );
}
