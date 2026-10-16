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
    schedule_date: "2026-10-24",
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
    weather_note: null,
    weather_note_updated_at: null,
    weather_note_updated_by: null,
    cancelled_at: null,
    cancelled_by: null,
    cancel_reason: null,
    target_blocks: ["middle_long"],
    created_by: "author-1",
    created_at: "2026-07-01T00:00:00.000Z",
    menus,
  };
}

describe("parseMiddleLongMenuCsv", () => {
  it("accepts the current eight-column export with editable A/H labels and two title rows", () => {
    const csv = ["synthetic title,,,,,,,", "synthetic instructions,,,,,,,", ",,,,,,,", "2,曜日,時間,場所,メニュー,ペース,補足,列 8",
      ...Array.from({ length: 31 }, (_, index) => `10/${index + 1},木,17:00,synthetic,menu,,,`)].join("\n");
    const rows = parseMiddleLongMenuCsv(csv, 10);
    expect(rows).toHaveLength(31); expect(rows[0].monthDay).toBe("10-01"); expect(rows[30].monthDay).toBe("10-31");
  });
  it("rejects changed columns, wrong-month rows and truncated date rows while allowing a verified empty month", () => {
    const header = "日付,曜日,時間,場所,メニュー,ペース,備考,補強";
    for (const csv of ["名前,内容\nsynthetic,menu", header.replace("日付,曜日", "曜日,日付") + "\n木,10/1,17:00,場所,menu,,,",
      header + "\n9/1,火,17:00,場所,menu,,,", header + "\n10/1,木,17:00", header + "\n10/40,木,17:00,場所,menu,,,"]) {
      expect(() => parseMiddleLongMenuCsv(csv, 10)).toThrow();
    }
    expect(parseMiddleLongMenuCsv(header + "\n10/1,木,,,,,,", 10)).toEqual([]);
  });
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
        time: "17:00",
        location: "武蔵野",
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
          monthDay: "10-24",
          sourceMonth: 10,
          time: "18:30",
          location: "府中",
          content: "スプシのメニュー",
          pace: "設定ペース",
          remark: "補足",
          supplement: "補強",
        }],
        loadedMonths: [10],
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
    expect(result).toMatchObject({ meeting_time: "18:30", venue_name: "府中" });
  });

  it("removes stale DB content only when that CSV month loaded", () => {
    const [loaded] = applyMiddleLongMenuSnapshot(
      [schedule([menu()])],
      { rows: [], loadedMonths: [10] },
    );
    expect(loaded.menus).toEqual([]);

    const original = schedule([menu()]);
    const [failed] = applyMiddleLongMenuSnapshot(
      [original],
      { rows: [], loadedMonths: [] },
    );
    expect(failed).toBe(original);
  });

  it("never applies rows from a month whose fetch/structure was not confirmed", () => {
    const original = schedule([menu()]);
    expect(applyMiddleLongMenuSnapshot([original], { loadedMonths: [], rows: [{ exactDate: null, monthDay: "10-24", sourceMonth: 10,
      time: "", location: "", content: "unconfirmed", pace: "", remark: "", supplement: "" }] })[0]).toBe(original);
  });

  it("preserves existing place and time when the sheet leaves them blank", () => {
    const [result] = applyMiddleLongMenuSnapshot([schedule([])], {
      rows: [{ exactDate: null, monthDay: "10-24", sourceMonth: 10,
        time: "", location: "", content: "ジョグ", pace: "5:00/km", remark: "", supplement: "" }],
      loadedMonths: [10],
    });
    expect(result).toMatchObject({ meeting_time: "17:00:00", venue_name: "武蔵野" });
  });

  it("does not change the place or time of a schedule shared with other blocks", () => {
    const shortMenu = menu({ id: "short-menu", target_block: "short", content: "短距離の種目練" });
    const shared = { ...schedule([shortMenu]), target_blocks: [] };
    const [result] = applyMiddleLongMenuSnapshot([shared], {
      rows: [{ exactDate: null, monthDay: "10-24", sourceMonth: 10,
        time: "18:30", location: "府中", content: "ジョグ", pace: "4:00/km", remark: "補足内容", supplement: "" }],
      loadedMonths: [10],
    });
    expect(result).toMatchObject({ meeting_time: "17:00:00", venue_name: "武蔵野" });
    expect(result.menus).toContain(shortMenu);
    expect(result.menus.find(item => item.source === "sheet")).toMatchObject({
      target_block: "middle_long", content: "ジョグ", pace: "4:00/km", remark: "補足内容", status: "published",
    });
  });

  it("does not apply this season's month/day to a different year", () => {
    const later = { ...schedule([]), schedule_date: "2027-10-24" };
    const [result] = applyMiddleLongMenuSnapshot([later], {
      rows: [{ exactDate: null, monthDay: "10-24", sourceMonth: 10,
        time: "18:30", location: "府中", content: "ジョグ", pace: "", remark: "", supplement: "" }],
      loadedMonths: [10],
    });
    expect(result.menus).toEqual([]);
    expect(result.venue_name).toBe("武蔵野");
  });
});
