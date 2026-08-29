import { normalizeAudienceBlocks } from "@/lib/constants";
import type { AuthorMini, Block } from "@/types";

type RoleAssignment = { profile_id: string; role_id: string };

/**
 * お知らせのブロック指定が、その部員に当たるかどうか。
 * DB 側の通知トリガーは profiles.blocks と mentioned_blocks の配列重なりで判定するため、
 * 画面の「通知対象◯人」も同じ完全一致で数える（matchSimpleBlock の
 * 「中長距離・短距離の指定にマネージャーも含める」挙動は出欠一覧などの表示用で、
 * ここで使うと実際には通知されない人まで数に入ってしまう）。
 */
export function noticeBlockMatches(
  personBlocks: Block[] | undefined | null,
  selectedBlocks: Block[],
): boolean {
  if (selectedBlocks.length === 0) return false;
  const normalized = new Set(normalizeAudienceBlocks(personBlocks));
  return normalizeAudienceBlocks(selectedBlocks).some((block) => normalized.has(block));
}

export function noticeConditionRecipientIds({
  people,
  roleAssignments,
  all,
  roleIds,
  blocks,
  grades,
}: {
  people: AuthorMini[];
  roleAssignments: RoleAssignment[];
  all: boolean;
  roleIds: string[];
  blocks: Block[];
  grades: string[];
}): string[] {
  return people
    .filter((person) =>
      all
      || noticeBlockMatches(person.blocks, blocks)
      || grades.includes(person.grade ?? "")
      || roleAssignments.some((assignment) => assignment.profile_id === person.id && roleIds.includes(assignment.role_id)),
    )
    .map((person) => person.id);
}

export function noticeRecipientIds(conditionIds: string[], personIds: string[], excludedPersonIds: string[]): string[] {
  const recipients = new Set([...conditionIds, ...personIds]);
  excludedPersonIds.forEach((id) => recipients.delete(id));
  return [...recipients];
}
