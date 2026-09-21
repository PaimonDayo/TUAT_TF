"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronDown, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
import {
  formatAthleteLabel,
  fromStoredProgramRow,
  groupEntriesByPosition,
  groupProgramByDate,
} from "@/lib/competition-program";
import type { ProgramAthlete, ParsedProgramRow } from "@/lib/competition-program";
import type { CompetitionProgramEntryRow, CompetitionRow } from "@/types";

import { CompetitionInProgress } from "./CompetitionInProgress";
import { ProgramEventSummary } from "./ProgramEventSummary";

const BLOCK_LABEL = { track: "トラック", field: "フィールド" } as const;

function resultText(entry: ProgramAthlete, block: "track" | "field"): string {
  const place = entry.result?.place ? `${entry.result.place}${block === "field" ? "位" : "着"} ` : "";
  const wind = entry.result?.wind ? `（風 ${entry.result.wind}）` : "";
  // タイムレースは組ごとの着順より総合順位のほうが意味がある。
  const overall = entry.result?.overallPlace ? ` 総合${entry.result.overallPlace}位` : "";
  return `${place}${entry.result?.record ?? ""}${wind}${overall}`;
}

/** 同じ組・レーンの全員が同一の結果（＝リレーのチーム記録）かどうか。 */
function sharedResult(entries: ProgramAthlete[]): boolean {
  if (entries.length < 2 || !entries[0].result) return false;
  const first = JSON.stringify(entries[0].result);
  return entries.every((entry) => JSON.stringify(entry.result) === first);
}

/** 1種目ぶんの行。タップで出場者ごとの組・レーン・結果を開く。 */
function ProgramRow({ row }: { row: ParsedProgramRow }) {
  const [open, setOpen] = useState(false);
  const finished = row.tuatEntries.filter((entry) => entry.result);

  return (
    <div className="p-3.5">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-start gap-2 text-left pressable">
        <span className="min-w-0 flex-1">
          <ProgramEventSummary row={row} />
          {finished.length > 0 && !open && (
            <span className="ml-15 mt-1 block text-caption tabular-nums text-accent">
              結果{finished.length}件（タップで表示）
            </span>
          )}
        </span>
        <ChevronDown size={16} className={"mt-1 shrink-0 text-muted transition-transform " + (open ? "rotate-180" : "")} />
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 sm:ml-[52px]">
          {groupEntriesByPosition(row.tuatEntries).map(({ position, entries }, index) => (
            <li key={index} className="rounded-lg bg-bg px-2.5 py-2 text-[13px]">
              {position && <p className="text-micro text-muted2">{position}</p>}
              {sharedResult(entries) ? (
                // リレーはチーム1つの記録なので、4人ぶん同じ行を繰り返さない。
                <p className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0">{entries.map(formatAthleteLabel).join("・")}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{resultText(entries[0], row.block)}</span>
                </p>
              ) : (
                entries.map((entry, i) => (
                  <p key={i} className="flex items-baseline justify-between gap-2">
                    <span>{formatAthleteLabel(entry)}</span>
                    <span className="shrink-0 font-semibold tabular-nums">
                      {entry.result ? resultText(entry, row.block) : <span className="font-normal text-muted2">結果待ち</span>}
                    </span>
                  </p>
                ))
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 大会プログラム（速報サイトから取り込んだ農工大の出場種目・出場選手と、その結果）。 */
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
      <Card className="p-4">
        <p className="mb-3 text-headline">{competition.name}</p>
        <CompetitionInProgress entries={initialEntries} />
      </Card>
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

      <p className="text-micro text-muted2">開催期間は約5分ごとに公式情報を取得します。記録は速報値です。</p>
      {competition.program_source_url && <a href={competition.program_source_url} target="_blank" rel="noopener noreferrer" className="text-caption text-accent underline">大会公式のプログラム・速報を見る</a>}
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
                    {group[block].map((row) => <ProgramRow key={row.roundKey} row={row} />)}
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
