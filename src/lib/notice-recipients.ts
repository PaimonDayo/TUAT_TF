import { matchSimpleBlock } from "@/lib/constants";
import type { AuthorMini, Block } from "@/types";

type RoleAssignment = { profile_id: string; role_id: string };

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
      || blocks.some((block) => matchSimpleBlock(person.blocks, block))
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
