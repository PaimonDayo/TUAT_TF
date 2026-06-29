import type { AppRole, Permission } from "@/types";

/** 権限 → roles テーブルのカラム名 */
const PERMISSION_COLUMN: Record<Permission, keyof AppRole> = {
  manage_system: "can_manage_system",
  manage_members: "can_manage_members",
  create_schedule: "can_create_schedule",
  create_menu: "can_create_menu",
  create_notice: "can_create_notice",
};

/** ロール作成・編集フォームで使う権限の一覧（表示順） */
export const PERMISSION_LIST: { key: Permission; label: string; desc: string }[] = [
  { key: "manage_system", label: "システム管理", desc: "最上位の設定を変更でき、自分が投稿したお知らせも通知を受け取る" },
  { key: "manage_members", label: "部員・ロール管理", desc: "ロールの作成や部員へのロール付与ができる（管理者）" },
  { key: "create_schedule", label: "練習予定の作成", desc: "練習・大会などの予定を作成できる" },
  { key: "create_menu", label: "練習メニューの作成", desc: "予定に練習メニューを追加できる" },
  { key: "create_notice", label: "お知らせの作成", desc: "お知らせを投稿できる" },
];

/** 所属ロールのいずれかが該当権限を持つか（権限は OR で合算） */
export function hasPermission(
  roles: AppRole[] | undefined | null,
  perm: Permission,
): boolean {
  const col = PERMISSION_COLUMN[perm];
  return (roles ?? []).some((r) => Boolean(r[col]));
}

/** よく使う権限セットをまとめて算出 */
export function permissionsOf(roles: AppRole[] | undefined | null) {
  return {
    manageSystem: hasPermission(roles, "manage_system"),
    manageMembers: hasPermission(roles, "manage_members"),
    createSchedule: hasPermission(roles, "create_schedule"),
    createMenu: hasPermission(roles, "create_menu"),
    createNotice: hasPermission(roles, "create_notice"),
  };
}
