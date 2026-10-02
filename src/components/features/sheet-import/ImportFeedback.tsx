import { AlertCircle } from "lucide-react";
import type { MenuImportEditableRow, ScheduleImportEditableRow } from "@/types";

export function Step({ number }: { number: number }) {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-white">
      {number}
    </span>
  );
}

/** 予定・メニューの取り込みで共通の判定結果だけを表示する。 */
export function RowStatus({ row }: {
  row: Pick<MenuImportEditableRow | ScheduleImportEditableRow, "status" | "message">;
}) {
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

export function SummaryCount({
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
