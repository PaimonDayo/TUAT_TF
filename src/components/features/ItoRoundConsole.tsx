"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { ITO_PHASE_LABELS } from "@/lib/ito-phase";
import { sortByGradeThenName } from "@/lib/member-sort";
import {
  advanceItoRound,
  moveItoMember,
  regenerateItoGroups,
  setItoLeaderAnswer,
  startItoRound,
} from "@/app/(app)/ito/actions";
import type {
  AuthorMini,
  ItoGame,
  ItoGroup,
  ItoGroupMember,
  ItoGroupOrder,
  ItoLeaderAnswer,
  ItoPhase,
  ItoRound,
  ItoRoundScore,
  ItoSecretStatus,
} from "@/types";

export interface ItoRoundConsoleData {
  game: ItoGame;
  round: ItoRound | null;
  groups: ItoGroup[];
  members: ItoGroupMember[];
  answers: ItoLeaderAnswer[];
  orders: ItoGroupOrder[];
  scores: ItoRoundScore[];
  secretStatus: ItoSecretStatus[];
  people: AuthorMini[];
  participantCount: number;
}

/** 次に進むボタンの文言（フェーズごと）。confirm が必要なものは description を持つ。 */
const NEXT_STEP: Record<
  ItoPhase,
  { to: ItoPhase; label: string; title?: string; description?: string } | null
> = {
  grouping: { to: "leader_select", label: "代表者選択へ進む" },
  leader_select: {
    to: "numbers",
    label: "代表者受付を終了して数字を配る",
    title: "代表者を確定して秘密数字を配りますか？",
    description: "この操作は元に戻せません。以降、代表者は変更できません。",
  },
  numbers: { to: "leader_answers", label: "代表者の回答入力へ" },
  leader_answers: { to: "ordering", label: "並び替え・回答受付を開始する" },
  ordering: {
    to: "locked",
    label: "回答受付を終了する",
    title: "回答受付を終了しますか？",
    description: "この操作は元に戻せません（受付の再開は可能です）。以降、部員は編集できません。",
  },
  locked: {
    to: "revealed",
    label: "みんなの予想を公開する",
    title: "みんなの予想を公開しますか？",
    description: "全員の端末に各グループの予想が表示されます。秘密数字はまだ公開されません。",
  },
  revealed: {
    to: "result",
    label: "結果を発表する",
    title: "結果を発表しますか？",
    description:
      "全員の端末に秘密数字と正解、得点が表示されます。この操作は元に戻せません。誤操作に注意してください。",
  },
  result: { to: "finished", label: "ラウンドを終了する" },
  finished: null,
};

export function ItoRoundConsole({ data }: { data: ItoRoundConsoleData }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<ItoPhase | null>(null);
  const { game, round, groups, members, answers, orders, scores, secretStatus, people } = data;

  useEffect(() => {
    if (!round) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`ito-admin-${round.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ito_group_members", filter: `round_id=eq.${round.id}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "ito_group_orders", filter: `round_id=eq.${round.id}` }, () => router.refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [round, router]);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      showToast(done);
      setConfirming(null);
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "実行できませんでした");
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (profileId: string) =>
    people.find((person) => person.id === profileId)?.display_name || "名無し";

  if (!round || round.phase === "finished") {
    return (
      <Card className="space-y-3 p-3">
        <p className="section-label">
          {round ? `Round ${round.round_no} は終了しました` : "ラウンド"}
        </p>
        {round && (
          <RoundResults
            groups={groups}
            scores={scores}
            orders={orders}
            nameOf={nameOf}
          />
        )}
        <p className="text-caption">
          参加者{data.participantCount}人 ／ {game.group_count}グループ × 最大
          {game.max_group_size}人で編成します。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            className="gap-1"
            onClick={() => void run(() => startItoRound(game.id, false), "ラウンドを開始しました")}
          >
            <Play size={15} /> {round ? "次のラウンドを開始（ランダム編成）" : "ラウンド1を開始する"}
          </Button>
          {round && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => startItoRound(game.id, true), "ラウンドを開始しました")}
            >
              同じ編成のまま開始
            </Button>
          )}
        </div>
      </Card>
    );
  }

  const next = NEXT_STEP[round.phase];
  const normalGroups = groups.filter((group) => !group.is_leader_team);
  const leaders = members.filter((member) => member.is_leader);
  const submitted = orders.filter((order) => order.submitted).length;

  return (
    <Card className="space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-headline">Round {round.round_no}</p>
        <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">
          {ITO_PHASE_LABELS[round.phase]}
        </span>
      </div>

      {round.phase === "grouping" && (
        <>
          <div className="space-y-2">
            {normalGroups.map((group) => (
              <div key={group.id} className="rounded-xl bg-bg/60 p-2.5">
                <p className="text-[13px] font-bold">{group.name}</p>
                <div className="mt-1 space-y-1">
                  {sortByGradeThenName(
                    people.filter((person) =>
                      members.some(
                        (member) =>
                          member.group_id === group.id && member.profile_id === person.id,
                      ),
                    ),
                  ).map((person) => (
                    <div key={person.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[14px]">
                        {person.display_name || "名無し"}
                      </span>
                      <Select
                        value={group.id}
                        ariaLabel={`${person.display_name}のグループ`}
                        onValueChange={(value) =>
                          void run(
                            () => moveItoMember(round.id, person.id, value),
                            "メンバーを移動しました",
                          )
                        }
                        options={normalGroups.map((option) => ({
                          value: option.id,
                          label: option.name,
                        }))}
                        className="w-28 shrink-0"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            className="gap-1"
            onClick={() => void run(() => regenerateItoGroups(round.id), "編成をやり直しました")}
          >
            <RefreshCw size={15} /> 編成をやり直す
          </Button>
        </>
      )}

      {round.phase === "leader_select" && (
        <div className="space-y-1">
          {normalGroups.map((group) => {
            const leader = members.find(
              (member) => member.group_id === group.id && member.is_leader,
            );
            return (
              <div key={group.id} className="flex items-center gap-2 text-[14px]">
                <span className="w-16 shrink-0 font-bold">{group.name}</span>
                <span className={leader ? "text-ink" : "text-warning"}>
                  {leader ? nameOf(leader.profile_id) : "未選択"}
                </span>
              </div>
            );
          })}
          <p className="text-caption">各グループの端末から代表者を選んでもらってください。</p>
        </div>
      )}

      {round.phase === "numbers" && (
        <div className="space-y-1">
          <p className="text-[14px]">
            配布済み {secretStatus.filter((status) => status.assigned).length} / {leaders.length}
            　本人確認済み {secretStatus.filter((status) => status.confirmed).length} /{" "}
            {leaders.length}
          </p>
          <p className="text-caption">
            代表者全員が数字を確認したら、回答の聞き取りへ進んでください。
          </p>
        </div>
      )}

      {round.phase === "leader_answers" && (
        <div className="space-y-2">
          <p className="text-caption">
            代表者の発言を聞いて、そのまま入力してください（自由入力・重複可）。
          </p>
          {leaders.map((leader) => (
            <AnswerInput
              key={leader.profile_id}
              roundId={round.id}
              profileId={leader.profile_id}
              name={nameOf(leader.profile_id)}
              initial={
                answers.find((answer) => answer.profile_id === leader.profile_id)?.answer ?? ""
              }
              showToast={showToast}
            />
          ))}
        </div>
      )}

      {(round.phase === "ordering" || round.phase === "locked") && (
        <div className="space-y-1">
          <p className="text-[14px] font-semibold tabular-nums">
            {submitted} / {groups.length} 回答済み
          </p>
          {groups.map((group) => {
            const order = orders.find((row) => row.group_id === group.id);
            const state = order?.submitted
              ? "提出済み"
              : (order?.order_ids.length ?? 0) > 0
                ? "編集中"
                : "未提出";
            return (
              <div key={group.id} className="flex items-center gap-2 text-[14px]">
                <span className="w-24 shrink-0 font-bold">{group.name}</span>
                <span
                  className={
                    state === "提出済み"
                      ? "text-success"
                      : state === "編集中"
                        ? "text-warning"
                        : "text-muted2"
                  }
                >
                  {state}
                </span>
              </div>
            );
          })}
          {round.phase === "locked" && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => advanceItoRound(round.id, "ordering"), "回答受付を再開しました")}
            >
              回答受付を再開する
            </Button>
          )}
        </div>
      )}

      {round.phase === "result" && (
        <RoundResults groups={groups} scores={scores} orders={orders} nameOf={nameOf} />
      )}

      {next && (
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            next.title
              ? setConfirming(next.to)
              : void run(() => advanceItoRound(round.id, next.to), `${next.label}を実行しました`)
          }
        >
          {next.label}
        </Button>
      )}

      {next?.title && (
        <ConfirmDialog
          open={confirming === next.to}
          onOpenChange={(open) => !open && setConfirming(null)}
          title={next.title}
          description={
            next.to === "locked" && submitted < groups.length
              ? `${next.description} まだ${groups.length - submitted}グループが未提出です。`
              : (next.description ?? "")
          }
          confirmLabel="実行する"
          busyLabel="実行中…"
          busy={busy}
          onConfirm={() =>
            void run(() => advanceItoRound(round.id, next.to), `${next.label}を実行しました`)
          }
        />
      )}
    </Card>
  );
}

function AnswerInput({
  roundId,
  profileId,
  name,
  initial,
  showToast,
}: {
  roundId: string;
  profileId: string;
  name: string;
  initial: string;
  showToast: (message: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(Boolean(initial));

  async function save() {
    if (value.trim() === initial.trim() && saved) return;
    setSaving(true);
    try {
      await setItoLeaderAnswer(roundId, profileId, value);
      setSaved(true);
    } catch {
      showToast("回答を保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate text-[14px] font-semibold">{name}</span>
      <Input
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setSaved(false);
        }}
        onBlur={() => void save()}
        placeholder="例: 武藤さん"
        maxLength={100}
      />
      <span className="w-10 shrink-0 text-right text-micro text-muted2">
        {saving ? "保存中" : saved ? "保存済" : ""}
      </span>
    </div>
  );
}

function RoundResults({
  groups,
  scores,
  orders,
  nameOf,
}: {
  groups: ItoGroup[];
  scores: ItoRoundScore[];
  orders: ItoGroupOrder[];
  nameOf: (profileId: string) => string;
}) {
  if (scores.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="section-label">ラウンド得点</p>
      {groups.map((group) => {
        const score = scores.find((row) => row.group_id === group.id);
        const order = orders.find((row) => row.group_id === group.id);
        if (!score) return null;
        return (
          <div key={group.id} className="flex items-center gap-2 text-[14px]">
            <span className="w-24 shrink-0 font-bold">{group.name}</span>
            <span className="flex-1 truncate text-[12px] text-muted2">
              {(order?.order_ids ?? []).map((id) => nameOf(id)).join(" > ")}
            </span>
            <span className="shrink-0 font-bold tabular-nums text-accent">
              {score.points}点{score.is_perfect && "（完全一致）"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
