"use client";

import { useState } from "react";
import { isCompetitionArchived } from "@/lib/competition-lifecycle";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { fromStoredProgramRow } from "@/lib/competition-program";
import type { CompetitionProgramEntryRow, CompetitionRow } from "@/types";

import { CompetitionInProgress } from "./CompetitionInProgress";
import { CompetitionResults } from "./CompetitionResults";
import { useCompetitionProgram } from "./useCompetitionProgram";

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
  const entries = useCompetitionProgram(competition, initialEntries);

  const rows = entries.map(fromStoredProgramRow).filter(row => row.tuatEntries.length > 0 || row.status?.includes("エントリー未確定"));
  const lastSyncedAt = entries.reduce<string | null>(
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
        {isCompetitionArchived(competition)
          ? <p className="text-caption">アーカイブ：大会の出場者と記録を保存しています。</p>
          : <CompetitionInProgress entries={entries} />}
      </Card>
      <div data-ui-group className="flex items-center justify-between gap-2 rounded-xl border border-separator bg-card p-3">
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

      <p className="text-micro text-muted2">{isCompetitionArchived(competition) ? "自動取得は終了しています。記録は最終取得時点の情報です。" : "開催期間は約5分ごとに公式情報を取得します。記録は速報値です。"}</p>
      {competition.program_source_url && <a data-ui-action="text" data-ui-tone="primary" href={competition.program_source_url} target="_blank" rel="noopener noreferrer" className="text-caption text-accent underline">大会公式のプログラムを見る</a>}
      <CompetitionResults rows={rows} />
    </div>
  );
}
