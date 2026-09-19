import { describe, expect, it } from "vitest";
import { recordSummaryText } from "./post-summary";

const base = {
  menu_text: null,
  result_text: null,
  memo: null,
  focus_text: null,
  strength_text: null,
  custom: null,
};

describe("recordSummaryText", () => {
  it("メニューがあればメニューを使う", () => {
    expect(recordSummaryText({ ...base, menu_text: "jog 60分", memo: "楽だった" })).toBe("jog 60分");
  });

  it("メニューが空なら次の項目へ送る", () => {
    expect(recordSummaryText({ ...base, menu_text: "  ", result_text: "3000m 9:45" })).toBe("3000m 9:45");
  });

  it("追加項目しかなければそれを使う", () => {
    expect(recordSummaryText({ ...base, custom: { sleep: "7時間" } })).toBe("7時間");
  });

  it("0だけの追加項目は中身として数えない", () => {
    expect(recordSummaryText({ ...base, custom: { weight: 0, mood: "good" } })).toBe("good");
  });

  it("何も書いていなければ空文字を返す", () => {
    expect(recordSummaryText(base)).toBe("");
  });
});
