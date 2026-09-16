"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import {
  formatAthletePosition,
  formatProgramEventLabel,
  fromStoredProgramRow,
  groupProgramByDate,
} from "@/lib/competition-program";
import type { CompetitionProgramEntryRow, CompetitionRow } from "@/types";

const BLOCK_LABEL = { track: "トラック", field: "フィールド" } as const;

/** 大会プログラム（速報サイトから取り込んだ農工大の出場種目・出場選手）の一覧。日付→トラック/フィールドの順。 */
export function CompetitionProgramView({
  competition,
  initialEntries,
  canManage,
}: {
  competition: CompetitionRow;
  initialEntries: CompetitionProgramEntryRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [syncing, setSyncing] = useState(false);

  const groups = groupProgramByDate(initialEntries.map(fromStoredProgramRow))
    .map((group) => ({
      ...group,
      track: group.track.filter((row) => row.tuatEntries.length > 0),
      field: group.field.filter((row) => row.tuatEntries.length > 0),
    }))
    .filter((group) => group.track.length > 0 || group.field.length > 0);
  const lastSyncedAt = initialEntries.reduce<string | null>(
    (latest, row) => (!latest || row.created_at > latest ? row.created_at : latest),
    null,
  );

  async function sync() {
    setSyncing(true);
    try {
      const response = await fetch("/api/competition-program/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ competitionId: competition.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error();
      router.refresh();
      showToast("プログラムを更新しました", "success");
    } catch {
      showToast("取得できませんでした。取得元URLを確認してください", "error");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4 px-4 pb-8 pt-2">
      {canManage && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-separator bg-card p-3">
          <p className="text-micro text-muted2">
            {lastSyncedAt
              ? `最終取得: ${format(new Date(lastSyncedAt), "M月d日 HH:mm", { locale: ja })}`
              : "まだ取得していません"}
          </p>
          <Button size="sm" variant="outline" disabled={syncing} onClick={() => void sync()}>
            <RefreshCw size={14} className={syncing ? "animate-spin" : undefined} />
            {syncing ? "取得中…" : "今すぐ取得"}
          </Button>
        </div>
      )}

      {groups.length === 0 ? (
        <Card>
          <EmptyState title="まだ出場種目の情報がありません" />
        </Card>
      ) : (
        groups.map((group) => (
          <section key={group.date} className="space-y-3">
            <p className="section-label">
              {format(new Date(`${group.date}T00:00:00`), "M月d日(E)", { locale: ja })}
            </p>
            {(["track", "field"] as const).map((block) =>
              group[block].length === 0 ? null : (
                <div key={block} className="space-y-1.5">
                  <p className="text-caption text-muted">{BLOCK_LABEL[block]}</p>
                  <Card className="divide-y divide-separator">
                    {group[block].map((row) => (
                      <div key={row.roundKey} className="space-y-1 p-3.5">
                        <div className="flex items-baseline gap-2">
                          <span className="shrink-0 text-caption tabular-nums text-muted">
                            {row.timeLabel ?? "--:--"}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-headline">
                            {formatProgramEventLabel(row.eventLabel)}
                          </span>
                        </div>
                        <p className="pl-[52px] text-[13px] text-muted2">
                          {row.tuatEntries.map(formatAthletePosition).join("、")}
                        </p>
                      </div>
                    ))}
                  </Card>
                </div>
              ),
            )}
          </section>
        ))
      )}
    </div>
  );
}
