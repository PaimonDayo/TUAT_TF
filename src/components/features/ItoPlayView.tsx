"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Eye, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ReorderList } from "@/components/ui/reorder-list";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { ITO_PHASE_LABELS, isItoAnswerEditable } from "@/lib/ito-phase";
import { correctItoOrder } from "@/lib/ito-score";
import { sortByGradeThenName } from "@/lib/member-sort";
import { cn } from "@/lib/utils";
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
  ItoSecret,
} from "@/types";

export interface ItoPlayData {
  game: ItoGame;
  round: ItoRound;
  groups: ItoGroup[];
  members: ItoGroupMember[];
  answers: ItoLeaderAnswer[];
  orders: ItoGroupOrder[];
  secrets: ItoSecret[];
  scores: ItoRoundScore[];
  people: AuthorMini[];
  viewerId: string;
}

interface LeaderCard {
  profileId: string;
  name: string;
  answer: string;
}

/** いま自分が何をすればよいか。画面の一番上に固定で出す。 */
function todoFor(phase: ItoPhase, amLeader: boolean, hasLeader: boolean): string {
  switch (phase) {
    case "grouping":
      return "グループが決まるのを待っています";
    case "leader_select":
      return hasLeader ? "代表者を確認（変更もできます）" : "代表者を選んでください";
    case "numbers":
      return amLeader ? "自分の数字を確認してください" : "代表者が数字を確認しています";
    case "leader_answers":
      return "代表者の答えを聞いて待っていてください";
    case "ordering":
      return amLeader
        ? "代表者どうしで、数字が大きい順に並べて提出"
        : "数字が大きい順に並べて提出してください";
    case "locked":
      return "回答は締め切られました。公開を待っています";
    case "revealed":
      return "みんなの予想が出ました。結果発表を待っています";
    case "result":
      return "結果発表です";
    case "finished":
      return "このラウンドは終わりました";
  }
}

/**
 * 部員から見たラウンド画面。
 * 「いまどの段階か」「自分は何をすればよいか」を上部に固定し、
 * その下にそのフェーズで必要なものだけを出す。
 */
export function ItoPlayView({ data }: { data: ItoPlayData }) {
  const router = useRouter();
  const { showToast } = useToast();
  const {
    game, round, groups, members, answers, orders, secrets, scores, people, viewerId,
  } = data;

  const nameOf = useCallback(
    (profileId: string) =>
      people.find((person) => person.id === profileId)?.display_name || "名無し",
    [people],
  );

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`ito-round-${round.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ito_rounds", filter: `id=eq.${round.id}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "ito_group_members", filter: `round_id=eq.${round.id}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "ito_group_orders", filter: `round_id=eq.${round.id}` }, () => router.refresh())
      .on("postgres_changes", { event: "*", schema: "public", table: "ito_leader_answers", filter: `round_id=eq.${round.id}` }, () => router.refresh())
      .subscribe();

    function visible() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      void supabase.removeChannel(channel);
    };
  }, [round.id, router]);

  const myMembership = members.find((member) => member.profile_id === viewerId);
  const myGroup = groups.find((group) => group.id === myMembership?.group_id);
  const leaderTeam = groups.find((group) => group.is_leader_team);
  const leaders = members.filter((member) => member.is_leader);
  const amLeader = Boolean(myMembership?.is_leader);
  // 代表者は自分の班の並び替えに参加せず、代表者チームを編集する。
  const editableGroup = amLeader ? leaderTeam : myGroup;
  const mySecret = secrets.find((secret) => secret.profile_id === viewerId);
  const myGroupLeader = members.find(
    (member) => member.group_id === myGroup?.id && member.is_leader,
  );

  const leaderCards: LeaderCard[] = useMemo(
    () =>
      leaders.map((leader) => ({
        profileId: leader.profile_id,
        name: nameOf(leader.profile_id),
        answer: answers.find((answer) => answer.profile_id === leader.profile_id)?.answer ?? "",
      })),
    [answers, leaders, nameOf],
  );

  // 正解が公開されている段階だけ、合っている位置を示せる。
  const correctOrder = useMemo(
    () =>
      round.phase === "result" || round.phase === "finished"
        ? correctItoOrder(
            secrets.map((secret) => ({ profileId: secret.profile_id, number: secret.number })),
          )
        : null,
    [round.phase, secrets],
  );

  if (!myMembership) {
    return (
      <Card className="p-4">
        <p className="text-[15px] font-semibold">このラウンドには参加していません</p>
        <p className="text-caption mt-1">次のラウンドの招待をお待ちください。</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* いまの段階と自分のやることは、スクロールしても見えるよう上に固定する。 */}
      <div className="sticky top-[calc(env(safe-area-inset-top)+3rem)] z-20 -mx-4 border-b border-separator bg-bg/95 px-4 py-2 backdrop-blur-xl lg:top-16">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">
            Round {round.round_no}
          </span>
          <span className="text-[13px] font-bold">{ITO_PHASE_LABELS[round.phase]}</span>
          {myGroup && (
            <span className="ml-auto rounded-full border-2 border-accent px-2 py-0.5 text-[11px] font-bold text-accent">
              {amLeader ? `${myGroup.name}・代表者` : myGroup.name}
            </span>
          )}
        </div>
        <p className="mt-1 text-[14px] font-semibold">
          {todoFor(round.phase, amLeader, Boolean(myGroupLeader))}
        </p>
      </div>

      {game.theme && (
        <Card className="p-3">
          <p className="text-micro text-muted2">お題</p>
          <p className="text-[16px] font-bold break-words">{game.theme}</p>
        </Card>
      )}

      {round.phase === "grouping" && myGroup && (
        <Card className="space-y-2 border-2 border-accent p-3">
          <p className="section-label">{myGroup.name}のメンバー</p>
          <MemberNames
            ids={members.filter((member) => member.group_id === myGroup.id).map((m) => m.profile_id)}
            people={people}
          />
        </Card>
      )}

      {round.phase === "leader_select" && myGroup && (
        <LeaderPicker
          group={myGroup}
          members={members.filter((member) => member.group_id === myGroup.id)}
          people={people}
          onDone={() => router.refresh()}
        />
      )}

      {(round.phase === "numbers" || round.phase === "leader_answers") && (
        <Card className="space-y-3 p-3">
          {amLeader && mySecret ? (
            <SecretNumber
              roundId={round.id}
              number={mySecret.number}
              confirmed={Boolean(mySecret.confirmed_at)}
            />
          ) : amLeader ? (
            <p className="text-[15px] font-semibold">数字の配布を待っています…</p>
          ) : (
            <>
              <p className="text-[15px] font-semibold">
                代表者は{myGroupLeader ? nameOf(myGroupLeader.profile_id) : "未定"}です
              </p>
              <p className="text-caption">
                代表者が「この数字なら○○」と声に出して答えます。並び替えの開始までお待ちください。
              </p>
            </>
          )}
        </Card>
      )}

      {(round.phase === "ordering" || round.phase === "locked") && editableGroup && (
        <OrderEditor
          key={editableGroup.id}
          group={editableGroup}
          order={orders.find((order) => order.group_id === editableGroup.id)}
          cards={leaderCards}
          editable={isItoAnswerEditable(round.phase) && (amLeader || !myMembership.is_leader)}
          locked={round.phase === "locked"}
          nameOf={nameOf}
          onSaved={() => router.refresh()}
          showToast={showToast}
        />
      )}

      {correctOrder && (
        <Card className="space-y-2 p-3">
          <p className="section-label">正解</p>
          <div className="space-y-2">
            {correctOrder.map((profileId, index) => {
              const card = leaderCards.find((item) => item.profileId === profileId);
              const number = secrets.find((secret) => secret.profile_id === profileId)?.number;
              return (
                <div
                  key={profileId}
                  className="flex items-center gap-3 rounded-xl bg-success/8 px-3 py-2"
                >
                  <span className="w-6 shrink-0 text-center text-[12px] font-bold text-muted2 tabular-nums">
                    {index + 1}
                  </span>
                  <span className="w-10 shrink-0 text-right text-[20px] font-bold tabular-nums text-accent">
                    {number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">
                      {card?.name ?? nameOf(profileId)}
                    </span>
                    {card?.answer && (
                      <span className="block truncate text-[12px] text-muted2">
                        「{card.answer}」
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {(round.phase === "revealed" || round.phase === "result" || round.phase === "finished") && (
        <Predictions
          groups={groups}
          orders={orders}
          cards={leaderCards}
          scores={round.phase === "revealed" ? [] : scores}
          myGroupId={editableGroup?.id}
          correctOrder={correctOrder}
        />
      )}
    </div>
  );
}

function MemberNames({ ids, people }: { ids: string[]; people: AuthorMini[] }) {
  const list = sortByGradeThenName(people.filter((person) => ids.includes(person.id)));
  return (
    <p className="text-[14px]">{list.map((person) => person.display_name || "名無し").join("、")}</p>
  );
}

/** 代表者選択（グループ共有）。誰の端末から選んでも全員に反映される。 */
function LeaderPicker({
  group,
  members,
  people,
  onDone,
}: {
  group: ItoGroup;
  members: ItoGroupMember[];
  people: AuthorMini[];
  onDone: () => void;
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const current = members.find((member) => member.is_leader)?.profile_id ?? null;
  const list = sortByGradeThenName(
    people.filter((person) => members.some((member) => member.profile_id === person.id)),
  );

  async function pick(profileId: string) {
    setBusy(profileId);
    const supabase = createClient();
    const { error } = await supabase.rpc("ito_set_leader", {
      target_group_id: group.id,
      leader_profile_id: profileId,
    });
    setBusy(null);
    if (error) {
      showToast("代表者を変更できませんでした");
      return;
    }
    onDone();
  }

  return (
    <Card className="space-y-2 border-2 border-accent p-3">
      <p className="section-label">{group.name}の代表者</p>
      <p className="text-caption">
        誰の端末から選んでも全員の画面に反映されます。受付終了までは変更できます。
      </p>
      <div className="space-y-1">
        {list.map((person) => {
          const active = current === person.id;
          return (
            <button
              key={person.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void pick(person.id)}
              className={cn(
                "flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-left",
                active ? "border-accent bg-accent/10" : "border-separator active:bg-bg",
              )}
            >
              <span className="flex-1 text-[15px] font-semibold">
                {person.display_name || "名無し"}
              </span>
              {busy === person.id ? (
                <Loader2 size={16} className="animate-spin text-muted" />
              ) : (
                active && <Check size={18} className="text-accent" />
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/** 自分の秘密数字。タップするまで隠す（覗き見防止）。 */
function SecretNumber({
  roundId,
  number,
  confirmed,
}: {
  roundId: string;
  number: number;
  confirmed: boolean;
}) {
  const [shown, setShown] = useState(false);

  async function reveal() {
    setShown(true);
    if (confirmed) return;
    const supabase = createClient();
    await supabase.rpc("ito_confirm_secret", { target_round_id: roundId });
  }

  return (
    <div className="space-y-2">
      <p className="section-label">あなたの数字</p>
      {shown ? (
        <p className="text-center text-[56px] font-bold leading-none tabular-nums text-accent">
          {number}
        </p>
      ) : (
        <Button size="lg" variant="outline" onClick={() => void reveal()} className="w-full gap-2">
          <Eye size={18} /> タップして数字を見る
        </Button>
      )}
      <p className="text-caption">
        この数字はあなたにしか見えません。数字そのものを言わずに、お題に沿った答えを声に出してください。
      </p>
    </div>
  );
}

/** グループ共有の並び替え。上ほど数字が大きい。 */
function OrderEditor({
  group,
  order,
  cards,
  editable,
  locked,
  nameOf,
  onSaved,
  showToast,
}: {
  group: ItoGroup;
  order?: ItoGroupOrder;
  cards: LeaderCard[];
  editable: boolean;
  locked: boolean;
  nameOf: (profileId: string) => string;
  onSaved: () => void;
  showToast: (message: string) => void;
}) {
  const serverOrder = useMemo(() => {
    const saved = order?.order_ids ?? [];
    const known = cards.map((card) => card.profileId);
    // サーバーの並びを正とし、足りない分（未提出時など）は後ろに足す。
    return [...saved.filter((id) => known.includes(id)), ...known.filter((id) => !saved.includes(id))];
  }, [cards, order?.order_ids]);

  // サーバーの並びを基準に、自分の未保存の編集だけを上に載せる。
  // 他の端末が保存してサーバー側が変わったら、そちらを正として自分の下書きは捨てる。
  const serverKey = serverOrder.join(",");
  const [draft, setDraft] = useState<{ base: string; order: string[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const local = draft && draft.base === serverKey ? draft.order : serverOrder;
  const dirty = local.join(",") !== serverKey;

  function apply(next: string[]) {
    setDraft({ base: serverKey, order: next });
  }

  function move(index: number, direction: -1 | 1) {
    const next = [...local];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    apply(next);
  }

  async function save(submit: boolean) {
    setSaving(true);
    const supabase = createClient();
    const { error } = await supabase.rpc("ito_set_order", {
      target_group_id: group.id,
      new_order: local,
      expected_revision: order?.revision ?? 0,
      submit,
    });
    setSaving(false);
    if (error) {
      if (error.message.includes("ito_order_conflict")) {
        showToast("ほかの人が先に更新しました。最新の並びに戻します");
        setDraft(null);
        onSaved();
        return;
      }
      showToast("並び順を保存できませんでした");
      return;
    }
    setDraft(null);
    showToast(submit ? "提出しました（サーバーに保存済み）" : "並び順を保存しました");
    onSaved();
  }

  const submitted = Boolean(order?.submitted) && !dirty;
  const items = local.map((profileId) => ({ id: profileId }));

  return (
    <Card className="space-y-3 border-2 border-accent p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="section-label">{group.name}の予想</p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-bold",
            submitted ? "bg-success/15 text-success" : "bg-warning/15 text-warning",
          )}
        >
          {locked ? "受付終了" : submitted ? "提出済み" : dirty ? "未保存" : "未提出"}
        </span>
      </div>

      <div className="rounded-xl bg-bg/60 px-3 py-2">
        <p className="text-[12px] font-bold text-accent">↑ 数字が大きい</p>
        <p className="text-caption">
          {editable
            ? "左の三本線をつまんで動かすか、右の矢印で入れ替えます。"
            : "このグループの並び替えには参加できません。"}
        </p>
        <p className="text-[12px] font-bold text-muted2">↓ 数字が小さい</p>
      </div>

      <ReorderList
        items={items}
        enabled={editable}
        onReorder={(next) => apply(next.map((item) => item.id))}
        renderItem={(item) => {
          const index = local.indexOf(item.id);
          const card = cards.find((entry) => entry.profileId === item.id);
          return (
            <div className="flex items-center gap-2 rounded-xl border border-separator bg-card px-3 py-2.5">
              <span className="w-5 shrink-0 text-center text-[12px] font-bold tabular-nums text-muted2">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[17px] font-bold">
                  {card?.name ?? nameOf(item.id)}
                </span>
                {card?.answer && (
                  <span className="block truncate text-[12px] text-muted2">「{card.answer}」</span>
                )}
              </span>
              {editable && (
                <span className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    aria-label="上へ"
                    onClick={() => move(index, -1)}
                    className="flex h-8 w-9 items-center justify-center rounded-lg border border-separator active:opacity-50"
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label="下へ"
                    onClick={() => move(index, 1)}
                    className="flex h-8 w-9 items-center justify-center rounded-lg border border-separator active:opacity-50"
                  >
                    <ArrowDown size={15} />
                  </button>
                </span>
              )}
            </div>
          );
        }}
      />

      {editable ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={saving || !dirty} onClick={() => void save(false)}>
            保存する
          </Button>
          <Button disabled={saving} onClick={() => void save(true)} className="gap-1">
            <Check size={16} /> {saving ? "送信中…" : "提出する"}
          </Button>
        </div>
      ) : (
        locked && <p className="text-caption">公開までお待ちください。</p>
      )}
      {order?.updated_by && (
        <p className="text-micro text-muted2">最終更新: {nameOf(order.updated_by)}</p>
      )}
    </Card>
  );
}

/** 公開後の各グループの予想。自分のグループは枠で強調し、正解が出ていれば合否も出す。 */
function Predictions({
  groups,
  orders,
  cards,
  scores,
  myGroupId,
  correctOrder,
}: {
  groups: ItoGroup[];
  orders: ItoGroupOrder[];
  cards: LeaderCard[];
  scores: ItoRoundScore[];
  myGroupId?: string;
  correctOrder: string[] | null;
}) {
  return (
    <div className="space-y-3">
      <p className="section-label">みんなの予想</p>
      {groups.map((group) => {
        const order = orders.find((row) => row.group_id === group.id);
        const score = scores.find((row) => row.group_id === group.id);
        const mine = group.id === myGroupId;
        return (
          <Card
            key={group.id}
            className={cn("space-y-2 p-3", mine && "border-2 border-accent")}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-[14px] font-bold">
                {group.name}
                {mine && <span className="ml-1 text-accent">（自分）</span>}
              </p>
              {score && (
                <span className="text-[14px] font-bold tabular-nums text-accent">
                  {score.points}点{score.is_perfect && "・完全一致"}
                </span>
              )}
            </div>

            {(order?.order_ids ?? []).length === 0 ? (
              <p className="text-caption">未提出</p>
            ) : (
              <div className="space-y-1">
                {(order?.order_ids ?? []).map((profileId, index) => {
                  const card = cards.find((entry) => entry.profileId === profileId);
                  const hit = correctOrder ? correctOrder[index] === profileId : null;
                  return (
                    <div
                      key={profileId}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2 py-1.5",
                        hit === true && "bg-success/10",
                        hit === false && "bg-danger/8",
                      )}
                    >
                      <span className="w-5 shrink-0 text-center text-[12px] font-bold tabular-nums text-muted2">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                        {card?.name ?? "?"}
                      </span>
                      {hit === true && <Check size={16} className="shrink-0 text-success" />}
                      {hit === false && <X size={16} className="shrink-0 text-danger" />}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
