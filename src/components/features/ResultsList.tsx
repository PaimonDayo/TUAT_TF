"use client";

import { useState } from "react";
import { Trophy, ChevronDown, ChevronUp } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import {
  formatRecord,
  formatRecordedOn,
  formatWind,
  measureTypeOf,
  recordGroupKey,
} from "@/lib/competition-record";
import type { CompetitionEvent } from "@/lib/competition-goals";
import type { PbRecord } from "@/types";

const PREVIEW = 5;

/**
 * 大会・記録会の結果リスト。
 * - 既定は直近 PREVIEW 件、「すべて見る」で全件展開
 * - 大学は年ごと、大学以前はひとまとめに表示
 * - onEdit / onDelete を渡すと各行に操作メニュー（本人とシステム管理者）
 */
export function ResultsList({
  results,
  events = [],
  onEdit,
  onDelete,
}: {
  results: PbRecord[];
  events?: CompetitionEvent[];
  onEdit?: (pb: PbRecord) => void;
  onDelete?: (id: string) => void | boolean | Promise<void | boolean>;
}) {
  const [expanded, setExpanded] = useState(false);

  if (results.length === 0) {
    return (
      <Card>
        <EmptyState
          title="まだ大会・記録会の結果はありません"
          icon={<Trophy size={28} />}
        />
      </Card>
    );
  }

  const shown = expanded ? results : results.slice(0, PREVIEW);
  const groups = groupRows(shown);

  return (
    <div className="space-y-3">
      {groups.map(([label, rows]) => (
        <div key={label} className="space-y-1.5">
          <p className="section-label">{label}</p>
          <Card className="divide-y divide-separator">
            {rows.map((pb) => (
              <ResultRow
                key={pb.id}
                pb={pb}
                events={events}
                onEdit={onEdit}
                onDelete={onDelete}
              />
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
  events,
  onEdit,
  onDelete,
}: {
  pb: PbRecord;
  events: CompetitionEvent[];
  onEdit?: (pb: PbRecord) => void;
  onDelete?: (id: string) => void | boolean | Promise<void | boolean>;
}) {
  const detail = [
    pb.meet_name,
    formatRecordedOn(pb.recorded_on, pb.date_precision),
    pb.wind !== null && pb.wind !== undefined ? `風速 ${formatWind(pb.wind)}` : "",
  ]
    .filter(Boolean)
    .join(" ・ ");
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
          {pb.is_official && (
            <span className="text-[10px] font-bold text-success border border-success rounded px-1 leading-tight">
              公認
            </span>
          )}
        </p>
        {detail && <p className="text-caption">{detail}</p>}
      </div>
      <span className="text-title tabular-nums">
        {formatRecord(pb, measureTypeOf(events, pb.event_name))}
      </span>
      {(onEdit || onDelete) && (
        <ActionMenu
          onEdit={onEdit ? () => onEdit(pb) : undefined}
          onDelete={onDelete ? () => onDelete(pb.id) : undefined}
          deleteTitle={`${pb.event_name}の結果を削除しますか？`}
          deleteDescription="削除した大会・記録会の結果は元に戻せません。"
          triggerLabel={`${pb.event_name}のメニュー`}
        />
      )}
    </div>
  );
}

/** 大学は年ごと、大学以前はまとめて（新しい年が先。日付なしは最後） */
function groupRows(rows: PbRecord[]): [string, PbRecord[]][] {
  const map = new Map<string, PbRecord[]>();
  for (const r of rows) {
    const key = recordGroupKey(r);
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return [...map.entries()];
}
