import { BLOCKS } from "./constants";
import { BLOCK_LEADER_ROLES } from "./menu-permissions";

/** ロール名で適用される権限を、設定と同じ画面で必ず説明する。 */
export function namedRoleCapabilities(name: string): string[] {
  if (name === "管理者") return ["他人のコメント・スプシ返信の削除（本文編集は本人のみ）"];
  if (name === "OB戦2026") return ["OB戦の回答・懇親会・補助員の管理（変更履歴は別権限）"];
  const block = BLOCK_LEADER_ROLES[name];
  return block ? [`${BLOCKS[block].label}メニューの編集（メニュー作成権限との併用・他人の削除は不可）`] : [];
}
