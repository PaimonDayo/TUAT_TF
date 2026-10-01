import type { AppRole, Block } from "@/types";
import { normalizeBlock } from "./constants";
import { permissionsOf } from "./permissions";

/** 現行ブロック区分。DBの can_edit_block_menu と合わせる。 */
export const BLOCK_LEADER_ROLES: Record<string, Block> = {
  "短距離ブロック長": "short",
  "投擲ブロック長": "short",
  "跳躍ブロック長": "short",
  "中距離ブロック長": "middle_long",
  "長距離ブロック長": "middle_long",
};

export function editableMenuBlocks(roles: AppRole[] | null | undefined): Block[] {
  if (!permissionsOf(roles).createMenu) return [];
  return [...new Set((roles ?? []).flatMap(role => !role.permissions_suppressed && BLOCK_LEADER_ROLES[role.name] ? [BLOCK_LEADER_ROLES[role.name]] : []))];
}

export function menuAccess({ userId, authorId, targetBlock, canCreate, canManageAll, editableBlocks = [] }: {
  userId?: string; authorId?: string; targetBlock: Block | null;
  canCreate: boolean; canManageAll: boolean; editableBlocks?: Block[];
}) {
  const canDelete = canManageAll || (!!userId && authorId === userId && canCreate);
  const canEdit = canDelete || (canCreate && targetBlock !== null && editableBlocks.includes(normalizeBlock(targetBlock)));
  return { canEdit, canDelete };
}
