import type { ItoPointSource } from "@/types";

/**
 * ito の採点。DB 側に同じ計算を置かず、ここだけを正とする
 * （SQL の ito_apply_scores() は保存だけを行う）。
 *
 * ルール（docs/ITO-PLAN.md §7）:
 * - 正しい位置にいる代表者の人数 = 得点
 * - 完全一致のときだけ N×2 点（5人なら10点、10人なら20点）
 * - 通常グループの点は「代表者を除くメンバー」へ、代表者には代表者チームの点
 */

export interface ItoSecretAssignment {
  profileId: string;
  number: number;
}

export interface ItoAnswerGroup {
  groupId: string;
  isLeaderTeam: boolean;
  /** 通常グループの代表者。代表者チームでは null */
  leaderId: string | null;
  /** そのグループの所属者（代表者を含む）。代表者チームでは空でよい */
  memberIds: string[];
  /** 提出された並び。上（先頭）ほど数字が大きい。未提出なら空配列 */
  order: string[];
}

export interface ItoOrderScore {
  correctCount: number;
  points: number;
  isPerfect: boolean;
}

export interface ItoGroupScore extends ItoOrderScore {
  groupId: string;
}

export interface ItoPointAward {
  profileId: string;
  points: number;
  source: ItoPointSource;
}

export interface ItoRoundScoreResult {
  /** 正解の並び（数字の大きい順） */
  correct: string[];
  scores: ItoGroupScore[];
  points: ItoPointAward[];
}

/** 秘密数字から正解の並びを作る（大きい順） */
export function correctItoOrder(secrets: ItoSecretAssignment[]): string[] {
  return [...secrets]
    .sort((a, b) => b.number - a.number)
    .map((secret) => secret.profileId);
}

/**
 * 1つの並びを採点する。
 * 未提出（空配列）や人数が合わない並びは 0 点として扱う。
 */
export function scoreItoOrder(correct: string[], guess: string[]): ItoOrderScore {
  const total = correct.length;
  if (total === 0 || guess.length !== total) {
    return { correctCount: 0, points: 0, isPerfect: false };
  }
  let correctCount = 0;
  for (let i = 0; i < total; i += 1) {
    if (correct[i] === guess[i]) correctCount += 1;
  }
  const isPerfect = correctCount === total;
  return { correctCount, points: isPerfect ? total * 2 : correctCount, isPerfect };
}

/**
 * ラウンド全体を採点し、グループ得点と個人得点を返す。
 * 同じ入力からいつでも再計算できるので、管理者の入力ミスは修正して再採点できる。
 */
export function scoreItoRound(input: {
  secrets: ItoSecretAssignment[];
  groups: ItoAnswerGroup[];
}): ItoRoundScoreResult {
  const correct = correctItoOrder(input.secrets);
  const scores: ItoGroupScore[] = [];
  const points: ItoPointAward[] = [];

  const leaderIds = input.groups
    .filter((group) => !group.isLeaderTeam)
    .map((group) => group.leaderId)
    .filter((id): id is string => Boolean(id));

  for (const group of input.groups) {
    const score = scoreItoOrder(correct, group.order);
    scores.push({ ...score, groupId: group.groupId });

    if (group.isLeaderTeam) {
      // 代表者チームの点は、そのラウンドの代表者全員へ。
      for (const leaderId of leaderIds) {
        points.push({ profileId: leaderId, points: score.points, source: "leader_team" });
      }
    } else {
      // 通常グループの点は、その班の代表者を除くメンバーへ。
      for (const memberId of group.memberIds) {
        if (memberId === group.leaderId) continue;
        points.push({ profileId: memberId, points: score.points, source: "group" });
      }
    }
  }

  return { correct, scores, points };
}

export interface ItoRankingRow {
  profileId: string;
  total: number;
  /** 同点は同順位。次の順位は人数分飛ばす（1位・1位・3位） */
  rank: number;
}

/** 得点履歴から個人累計ランキングを作る（累計値は保存しない） */
export function itoRanking(
  events: { profileId: string; points: number }[],
): ItoRankingRow[] {
  const totals = new Map<string, number>();
  for (const event of events) {
    totals.set(event.profileId, (totals.get(event.profileId) ?? 0) + event.points);
  }
  const sorted = [...totals.entries()]
    .map(([profileId, total]) => ({ profileId, total }))
    .sort((a, b) => b.total - a.total || a.profileId.localeCompare(b.profileId));

  const rows: ItoRankingRow[] = [];
  sorted.forEach((row, index) => {
    const previous = rows[index - 1];
    const rank = previous && previous.total === row.total ? previous.rank : index + 1;
    rows.push({ ...row, rank });
  });
  return rows;
}
