import { describe, expect, it } from "vitest";
import { applyMiddleLongMenuSnapshot } from "./middle-long-menu-data";
import { parseMiddleLongMenuCsv } from "./middle-long-menu-sheet";
import type { PracticeMenu, ScheduleWithMenus } from "@/types";

function menu(overrides: Partial<PracticeMenu> = {}): PracticeMenu {
  return {
    id: "db-menu",
    schedule_id: "schedule-1",
    author_id: "author-1",
    group_name: null,
    content: "DBの中長メニュー",
    pace: null,
    remark: null,
    supplement: null,
    target_block: "middle_long",
    status: "published",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    targets: [],
    ...overrides,
  };
}

function schedule(menus: PracticeMenu[]): ScheduleWithMenus {
  return {
    id: "schedule-1",
    schedule_date: "2026-07-24",
    schedule_type: "practice",
    meeting_time: "17:00:00",
    location: null,
    venue_name: "武蔵野",
    venue_access: null,
    venue_fee: null,
    title: null,
    end_date: null,
    entry_start: null,
    entry_end: null,
    venue_url: null,
    note: null,
    target_blocks: ["middle_long"],
    created_by: "author-1",
    created_at: "2026-07-01T00:00:00.000Z",
    menus,
  };
}

describe("parseMiddleLongMenuCsv", () => {
  it("reads the old app A:H monthly menu layout", () => {
    const csv = [
      "7月メニュー,,,,,,,,",
      "日付,曜日,時間,場所,メニュー,ペース,備考,補強",
      '7/24,金,17:00,武蔵野,"400m×5\\nつなぎ200m","72秒","給水を忘れずに","体幹3セット"',
    ].join("\n");

    expect(parseMiddleLongMenuCsv(csv, 7)).toEqual([
      {
        exactDate: null,
        monthDay: "07-24",
        sourceMonth: 7,
        content: "400m×5\nつなぎ200m",
        pace: "72秒",
        remark: "給水を忘れずに",
        supplement: "体幹3セット",
      },
    ]);
  });
});

describe("applyMiddleLongMenuSnapshot", () => {
  it("replaces only the common middle-long menu and keeps personal menus", () => {
    const personal = menu({
      id: "personal",
      content: "個人メニュー",
      targets: [{ menu_id: "personal", user_id: "user-1" }],
    });
    const [result] = applyMiddleLongMenuSnapshot(
      [schedule([menu(), personal])],
      {
        rows: [{
          exactDate: null,
          monthDay: "07-24",
          sourceMonth: 7,
          content: "スプシのメニュー",
          pace: "設定ペース",
          remark: "補足",
          supplement: "補強",
        }],
        loadedMonths: [7],
      },
    );

    expect(result.menus).toHaveLength(2);
    expect(result.menus.find((item) => item.source === "sheet")).toMatchObject({
      content: "スプシのメニュー",
      pace: "設定ペース",
      remark: "補足",
      supplement: "補強",
    });
    expect(result.menus).toContain(personal);
  });

  it("removes stale DB content only when that CSV month loaded", () => {
    const [loaded] = applyMiddleLongMenuSnapshot(
      [schedule([menu()])],
      { rows: [], loadedMonths: [7] },
    );
    expect(loaded.menus).toEqual([]);

    const original = schedule([menu()]);
    const [failed] = applyMiddleLongMenuSnapshot(
      [original],
      { rows: [], loadedMonths: [] },
    );
    expect(failed).toBe(original);
  });
});
