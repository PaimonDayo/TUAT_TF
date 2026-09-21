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
  formatAthleteLabel,
  formatProgramEventLabel,
  fromStoredProgramRow,
  groupProgramByDate,
} from "@/lib/competition-program";
import type { CompetitionProgramEntryRow, CompetitionRow } from "@/types";

import { CompetitionInProgress } from "./CompetitionInProgress";

const BLOCK_LABEL = { track: "トラック", field: "フィールド" } as const;

/** 大会プログラム（速報サイトから取り込んだ農工大の出場種目・出場選手）の一覧。日付→トラック/フィールドの順。 */
export function CompetitionProgramView({
  competition,
  initialEntries,
  canManage,
  initialView = "program",
}: {
  competition: CompetitionRow;
  initialEntries: CompetitionProgramEntryRow[];
  canManage: boolean;
  initialView?: "program" | "results";
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [view, setView] = useState(initialView);
  const [syncing, setSyncing] = useState(false);


  const groups = groupProgramByDate(initialEntries.map(fromStoredProgramRow))
    .map((group) => ({
      ...group,
      track: group.track.filter((row) => row.tuatEntries.length > 0 && (view === "program" || row.tuatEntries.some(entry => entry.result))),
      field: group.field.filter((row) => row.tuatEntries.length > 0 && (view === "program" || row.tuatEntries.some(entry => entry.result))),
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
      <CompetitionInProgress entries={initialEntries} />
      <div className="flex gap-2" role="group" aria-label="表示内容">
        <Button variant={view === "program" ? "primary" : "outline"} onClick={() => setView("program")} aria-pressed={view === "program"}>プログラム</Button>
        <Button variant={view === "results" ? "primary" : "outline"} onClick={() => setView("results")} aria-pressed={view === "results"}>速報</Button>
      </div>
      {(
        <div className="flex items-center justify-between gap-2 rounded-xl border border-separator bg-card p-3">
          <p className="text-micro text-muted2">
            {lastSyncedAt
              ? `最終取得: ${format(new Date(lastSyncedAt), "M月d日 HH:mm", { locale: ja })}`
              : "まだ取得していません"}
          </p>
          {canManage && <Button size="sm" variant="outline" disabled={syncing} onClick={() => void sync()}>
            <RefreshCw size={14} className={syncing ? "animate-spin" : undefined} />
            {syncing ? "取得中…" : "今すぐ取得"}
          </Button>}
        </div>
      )}

      <p className="text-micro text-muted2">開催期間は約5分ごとに公式情報を取得します。記録は速報値です。</p>
      {competition.program_source_url && <a href={competition.program_source_url} target="_blank" rel="noopener noreferrer" className="text-caption text-accent underline">大会公式のプログラム・速報を見る</a>}
      {groups.length === 0 ? (
        <Card>
          <EmptyState title={view === "results" ? "農工大の結果はまだ掲載されていません" : "まだ出場種目の情報がありません"} />
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
                          <span className="min-w-0 flex-1 text-headline">
                            {formatProgramEventLabel(row.eventLabel)}
                          </span>
                        </div>
                        {view === "program" && <p className="pl-[52px] text-[13px] text-muted2">
                          {row.tuatEntries.map(formatAthletePosition).join("、")}
                        </p>}
                        {row.tuatEntries.filter(entry => entry.result).map((entry, index) => (
                          <div key={index} className="rounded-lg bg-accent/5 px-2 py-1.5 text-[13px] sm:ml-[52px]">
                            <span>{formatAthleteLabel(entry)} {entry.heat ? entry.heat + "組" : ""}{entry.result?.place ? " " + entry.result.place + (block === "field" ? "位" : "着") : ""}</span>
                            <span className="block font-semibold tabular-nums">結果：{entry.result?.record}{entry.result?.wind ? " (風 " + entry.result.wind + ")" : ""}</span>
                          </div>
                        ))}
                        {competition.program_source_url && <a className="block pl-[52px] text-micro text-accent" href={competition.program_source_url.split("#")[0] + "#" + row.roundKey} target="_blank" rel="noopener noreferrer">公式の種目詳細</a>}
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
