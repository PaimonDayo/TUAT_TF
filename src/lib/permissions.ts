import type { AppRole, Permission } from "@/types";

/** 権限 → roles テーブルのカラム名 */
const PERMISSION_COLUMN: Record<Permission, keyof AppRole> = {
  manage_system: "can_manage_system",
  manage_members: "can_manage_members",
  create_schedule: "can_create_schedule",
  create_menu: "can_create_menu",
  create_notice: "can_create_notice",
  decide_practice: "can_decide_practice",
};

/** ロール作成・編集フォームで使う権限の一覧（表示順） */
export const PERMISSION_LIST: { key: Permission; label: string; desc: string }[] = [
  { key: "manage_system", label: "システム管理", desc: "最上位の設定を変更でき、自分が投稿したお知らせも通知を受け取る" },
  { key: "manage_members", label: "部員・ロール管理", desc: "部員・ロール、他人のメニュー・ノート・スレッドの管理、OB変更履歴の閲覧ができる" },
  { key: "create_schedule", label: "練習予定の作成・管理", desc: "他人の予定も編集・削除でき、練習場所も管理できる。大会マスタ管理はシステム権限が必要" },
  { key: "create_menu", label: "練習メニューの作成", desc: "新規作成と自分のメニューの編集・削除、中長距離スプシの編集ができる。ブロック長は担当ブロックの他人のメニューも編集できる" },
  { key: "create_notice", label: "お知らせの作成・管理", desc: "他人のお知らせも編集・削除できる。全員ロールに付与すると全員が操作可能" },
  { key: "decide_practice", label: "練習の開催判断", desc: "雨天時など、出欠欄に「話し合い中です」等の対応状況を表示できる" },
];

/** 所属ロールのいずれかが該当権限を持つか（権限は OR で合算） */
export function hasPermission(
  roles: AppRole[] | undefined | null,
  perm: Permission,
): boolean {
  const col = PERMISSION_COLUMN[perm];
  return (roles ?? []).some((r) => !r.permissions_suppressed && Boolean(r[col]));
}

/** よく使う権限セットをまとめて算出 */
export function permissionsOf(roles: AppRole[] | undefined | null) {
  return {
    manageSystem: hasPermission(roles, "manage_system"),
    manageMembers: hasPermission(roles, "manage_members"),
    createSchedule: hasPermission(roles, "create_schedule"),
    createMenu: hasPermission(roles, "create_menu"),
    createNotice: hasPermission(roles, "create_notice"),
    decidePractice: hasPermission(roles, "decide_practice"),
  };
}

/** 管理者によるコメント削除。本文の編集権限は投稿者だけに保持する。 */
export function canModerateComments(roles: AppRole[] | undefined | null): boolean {
  return !!roles?.some(role => !role.permissions_suppressed && role.name === "管理者");
}
