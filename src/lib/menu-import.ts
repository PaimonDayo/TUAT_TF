import { BLOCK_LABELS, normalizeImportValues, parseSheetDate } from "@/lib/schedule-import";
import type {
  Block,
  MenuImportEditableRow,
  MenuImportPreview,
  MenuImportRow,
  PracticeMenu,
  PracticeSchedule,
} from "@/types";

export const MENU_IMPORT_COLUMNS = ["日付", "対象ブロック", "メニュー", "ペース", "補足", "補強"];

export type SubmittedMenuRow = {
  rowNumber: number;
  values: Record<string, string>;
};

export function canonicalMenuImportValues(
  raw: Record<string, string>,
): Record<string, string> {
  return normalizeImportValues({
    "日付": raw["日付"] ?? raw["開始日"],
    "対象ブロック": raw["対象ブロック"],
    "メニュー": raw["メニュー"] ?? raw["詳細"],
    "ペース": raw["ペース"],
    "補足": raw["補足"],
    "補強": raw["補強"],
  });
}

export function requiredMenuImportHeaders(): string[][] {
  return [["日付"]];
}

export function validateMenuImportRows({
  rows,
  defaultYear,
  defaultBlock,
  schedules,
  menus,
}: {
  rows: SubmittedMenuRow[];
  defaultYear: number;
  defaultBlock: Block;
  schedules: PracticeSchedule[];
  /** ブロック全体メニュー（対象者指定なし）のみを更新候補にする */
  menus: PracticeMenu[];
}): MenuImportPreview {
  const preview: MenuImportPreview = {
    columns: MENU_IMPORT_COLUMNS,
    rows: [],
    additions: [],
    updates: [],
    errors: [],
    skips: [],
  };
  const usedMenuIds = new Set<string>();

  for (const submitted of rows) {
    const result = validateRow(
      submitted,
      defaultYear,
      defaultBlock,
      schedules,
      menus,
      usedMenuIds,
    );
    preview.rows.push(result);
    if (result.status === "addition" && result.normalized) {
      preview.additions.push(result.normalized);
    } else if (result.status === "update" && result.normalized) {
      preview.updates.push(result.normalized);
    } else if (result.status === "error") {
      preview.errors.push({
        rowNumber: result.rowNumber,
        message: result.message ?? "入力内容を確認してください",
      });
    } else if (result.status === "skip") {
      preview.skips.push({
        rowNumber: result.rowNumber,
        message: result.message ?? "スキップ",
      });
    }
  }
  return preview;
}

function validateRow(
  submitted: SubmittedMenuRow,
  defaultYear: number,
  defaultBlock: Block,
  schedules: PracticeSchedule[],
  menus: PracticeMenu[],
  usedMenuIds: Set<string>,
): MenuImportEditableRow {
  const values = normalizeImportValues(submitted.values);
  const result = (
    status: "error" | "skip",
    message: string,
  ): MenuImportEditableRow => ({
    rowNumber: submitted.rowNumber,
    values,
    status,
    message,
    normalized: null,
  });

  if (Object.values(values).every((value) => !value)) {
    return result("skip", "空行");
  }

  const date = parseSheetDate(values["日付"], defaultYear);
  if (!date) {
    return result("error", "日付を確認してください");
  }

  const blockText = values["対象ブロック"];
  const resolved = blockText ? BLOCK_LABELS[blockText] : defaultBlock;
  if (!resolved || resolved === "all") {
    return result("error", `対象ブロックを確認してください: ${blockText || "(未指定)"}`);
  }
  const block = resolved;

  const content = values["メニュー"] ?? "";
  const pace = values["ペース"] ?? "";
  const remark = values["補足"] ?? "";
  const supplement = values["補強"] ?? "";
  if (!content && !pace && !remark && !supplement) {
    return result("skip", "内容なし");
  }

  const schedule = schedules.find(
    (item) =>
      item.schedule_date === date &&
      ((item.target_blocks ?? []).length === 0 ||
        (item.target_blocks ?? []).includes(block)),
  );
  if (!schedule) {
    return result("error", "対象日の予定が見つかりません。先に予定を登録してください");
  }

  const existingMenu = menus.find(
    (menu) =>
      menu.schedule_id === schedule.id &&
      menu.target_block === block &&
      (menu.targets?.length ?? 0) === 0 &&
      !usedMenuIds.has(menu.id),
  );
  if (existingMenu) usedMenuIds.add(existingMenu.id);

  const normalized: MenuImportRow = {
    rowNumber: submitted.rowNumber,
    scheduleId: schedule.id,
    scheduleDate: date,
    targetBlock: block,
    content,
    pace: pace || null,
    remark: remark || null,
    supplement: supplement || null,
    existingMenuId: existingMenu?.id ?? null,
  };
  return {
    rowNumber: submitted.rowNumber,
    values,
    status: existingMenu ? "update" : "addition",
    message: existingMenu ? "更新予定" : "追加予定",
    normalized,
  };
}
