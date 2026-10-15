import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MemberSheetSettings } from "@/lib/queries";
import { AdminSheetSettings } from "./AdminSheetSettings";

function member(overrides: Partial<MemberSheetSettings> = {}): MemberSheetSettings {
  return {
    id: "member-1", display_name: "確認用の部員", blocks: ["short"], grade: "1", status: "active",
    sheet_name: "確認用シート", sheet_transition: null, record_fields: [], ...overrides,
  };
}

function render(members: MemberSheetSettings[]) {
  return renderToStaticMarkup(createElement(AdminSheetSettings, { members }));
}

describe("system sheet settings overview", () => {
  it("separates selected timeline fields from input-only and hidden fields", () => {
    const html = render([member({ record_fields: [
      { key: "menu_text", label: "表示する練習", type: "text", showInTimeline: true },
      { key: "input_only", label: "入力だけの項目", type: "text", showInTimeline: false },
      { key: "hidden", label: "外した項目", type: "text", hidden: true, showInTimeline: true },
    ] })]);
    const timeline = html.slice(html.indexOf("タイムラインに表示する項目"));
    expect(html).toContain("入力だけの項目");
    expect(timeline).toContain("表示する練習");
    expect(timeline).not.toContain("入力だけの項目");
    expect(html).not.toContain("外した項目");
  });

  it("distinguishes legacy defaults from an explicit choice to display no fields", () => {
    expect(render([member()])).toContain("標準の表示（保存済みの非表示設定を使用）");
    expect(render([member({ record_fields: [{ key: "memo", label: "感想", type: "text", showInTimeline: false }] })]))
      .toContain("表示する項目はありません");
  });

  it("preserves legacy hidden fields and labels without describing them as unconfigured", () => {
    const html = render([member({ record_fields: [
      { key: "memo", label: "隠した感想", type: "text", hidden: true },
      { key: "menu_text", label: "変更した練習名", type: "text" },
    ] })]);
    expect(html).toContain("標準の表示（保存済みの非表示設定を使用）");
    expect(html).toContain("変更した練習名");
    expect(html).not.toContain("隠した感想");
    expect(html).not.toContain("個別設定なし");
  });

  it("shows disabled integration even when the saved sheet and fields remain", () => {
    const html = render([member({
      sheet_transition: { mode: "off" },
      record_fields: [{ key: "memo", label: "現在の感想", type: "text", showInTimeline: true }],
    })]);
    expect(html).toContain("スプレッドシートと連携しない");
    expect(html).toContain("確認用シート");
    expect(html).toContain("現在の感想");
    expect(html).not.toContain("旧シート");
  });

  it("retains graduated members, unknown grades, and members without a sheet", () => {
    const html = render([
      member({ id: "known", display_name: "既知の学年" }),
      member({ id: "unknown", display_name: "未知の学年", grade: "OB", status: "graduated", sheet_name: null }),
      member({ id: "none", display_name: "学年未設定", grade: null }),
    ]);
    expect(html).toContain("3 / 3");
    for (const label of ["B1", "その他・学年未設定", "既知の学年", "未知の学年", "学年未設定", "卒業", "未選択", "10月以降の設定は未確認です"]) expect(html).toContain(label);
  });

  it("identifies the fixed middle/long distance fields", () => {
    const html = render([member({ blocks: ["middle_long"], record_fields: [
      { key: "strides", label: "流し", sourceHeader: "流し", sourceColumn: 3, type: "number", showInTimeline: true },
      { key: "memo", label: "感想", sourceColumn: 4, type: "text", showInTimeline: true },
    ] })]);
    expect(html).toContain("流し<span");
    expect(html.match(/（標準）/g)).toHaveLength(2);
  });
});
