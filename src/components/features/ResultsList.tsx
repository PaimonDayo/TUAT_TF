"use client";

import { useState } from "react";
import { Trophy, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { PbRecord } from "@/types";

const PREVIEW = 5;

/**
 * 大会・記録会の結果リスト。
 * - 既定は直近 PREVIEW 件、「すべて見る」で全件展開
 * - 年ごとにグループ表示
 * - onDelete を渡すと各行に削除ボタン（自分の管理画面用）
 */
export function ResultsList({
  results,
  onDelete,
}: {
  results: PbRecord[];
  onDelete?: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (results.length === 0) {
    return (
      <Card className="p-6 flex flex-col items-center gap-2">
        <Trophy size={28} className="text-warning" />
        <p className="text-caption text-center">まだ大会・記録会の結果がありません</p>
      </Card>
    );
  }

  const shown = expanded ? results : results.slice(0, PREVIEW);
  const groups = groupByYear(shown);

  return (
    <div className="space-y-3">
      {groups.map(([year, rows]) => (
        <div key={year} className="space-y-1.5">
          <p className="section-label">{year}</p>
          <Card className="divide-y divide-separator">
            {rows.map((pb) => (
              <ResultRow key={pb.id} pb={pb} onDelete={onDelete} />
            ))}
          </Card>
        </div>
      ))}

      {results.length > PREVIEW && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full h-11 rounded-xl border border-separator bg-card text-[14px] font-semibold text-accent inline-flex items-center justify-center gap-1 active:bg-bg"
        >
          {expanded ? (
            <>
              <ChevronUp size={16} /> 閉じる
            </>
          ) : (
            <>
              <ChevronDown size={16} /> すべて見る（{results.length}件）
            </>
          )}
        </button>
      )}
    </div>
  );
}

function ResultRow({
  pb,
  onDelete,
}: {
  pb: PbRecord;
  onDelete?: (id: string) => void;
}) {
  return (
    <div className="p-3.5 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-headline flex items-center gap-1.5 flex-wrap">
          {pb.event_name}
          {pb.is_pb && (
            <span className="text-[10px] font-bold text-warning border border-warning rounded px-1 leading-tight">
              PB
            </span>
          )}
          {pb.is_ub && (
            <span className="text-[10px] font-bold text-accent border border-accent rounded px-1 leading-tight">
              UB
            </span>
          )}
        </p>
        {(pb.meet_name || pb.recorded_on) && (
          <p className="text-caption">
            {[pb.meet_name, pb.recorded_on].filter(Boolean).join(" ・ ")}
          </p>
        )}
      </div>
      <span className="text-title tabular-nums">{pb.record}</span>
      {onDelete && (
        <button
          onClick={() => onDelete(pb.id)}
          aria-label="削除"
          className="text-muted active:text-danger"
        >
          <Trash2 size={18} />
        </button>
      )}
    </div>
  );
}

/** recorded_on の年でグループ化（新しい年が先。日付なしは最後） */
function groupByYear(rows: PbRecord[]): [string, PbRecord[]][] {
  const map = new Map<string, PbRecord[]>();
  for (const r of rows) {
    const year = r.recorded_on ? `${r.recorded_on.slice(0, 4)}年` : "日付未設定";
    const arr = map.get(year) ?? [];
    arr.push(r);
    map.set(year, arr);
  }
  return [...map.entries()];
}
