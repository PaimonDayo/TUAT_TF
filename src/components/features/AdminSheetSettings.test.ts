import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MemberSheetSettings, MemberSheetSettingsDetail } from "@/lib/queries";
import { AdminSheetSettings } from "./AdminSheetSettings";
import { AdminSheetSettingsDetail } from "./AdminSheetSettingsDetail";
import { MemberDirectory } from "./MemberDirectory";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function member(overrides: Partial<MemberSheetSettings> = {}): MemberSheetSettings {
  return { id: "member-1", display_name: "確認用の部員", avatar_url: null, blocks: ["short"], grade: "1", status: "active", ...overrides };
}
function detail(overrides: Partial<MemberSheetSettingsDetail["periods"][number]> = {}): MemberSheetSettingsDetail {
  return { ...member(), periods: [
    { id: "october", label: "2026年10月1日以降", sheet_name: "現在のシート", mode: "sheet", fields: [], editable: true, ...overrides },
    { id: "legacy", label: "2026年9月30日以前（連携終了）", sheet_name: "以前のシート", mode: "sheet", fields: [{ key: "old", label: "以前の項目", type: "text" }], editable: false },
  ] };
}
function renderDetail(value: MemberSheetSettingsDetail) { return renderToStaticMarkup(createElement(AdminSheetSettingsDetail, { member: value })); }

describe("system sheet member directory", () => {
  it("links compact member rows to settings without expanding all details", () => {
    const html = renderToStaticMarkup(createElement(AdminSheetSettings, { members: [member(), member({ id: "other", display_name: "別の部員" })] }));
    expect(html).toContain('/admin/sheets/member-1');
    expect(html).toContain('/admin/sheets/other');
    expect(html).toContain("別の部員");
    expect(html).not.toContain("入力フォームの項目");
    expect(html).not.toContain("タイムラインに表示する項目");
  });
  it("retains the original profile destination in the ordinary member directory", () => {
    const html = renderToStaticMarkup(createElement(MemberDirectory, { members: [member()] }));
    expect(html).toContain('/members/member-1');
    expect(html).not.toContain('/admin/sheets/');
  });
  it("keeps known, unknown, and missing grades visible", () => {
    const html = renderToStaticMarkup(createElement(AdminSheetSettings, { members: [member(), member({ id: "ob", display_name: "卒業した部員", grade: "OB", status: "graduated" }), member({ id: "none", display_name: "学年なし", grade: null })] }));
    for (const label of ["確認用の部員", "卒業した部員", "学年なし", "その他・学年未設定"]) expect(html).toContain(label);
  });
});

describe("selected member sheet settings", () => {
  it("shows one period and keeps input-only and hidden fields out of the timeline selection", () => {
    const html = renderDetail(detail({ fields: [
      { key: "menu_text", label: "表示する練習", type: "text", showInTimeline: true },
      { key: "input_only", label: "入力だけの項目", type: "text", showInTimeline: false },
      { key: "hidden", label: "外した項目", type: "text", hidden: true, showInTimeline: true },
    ] }));
    const timeline = html.slice(html.indexOf("タイムラインに表示する項目"));
    expect(html).toContain("入力だけの項目");
    expect(timeline).toContain("表示する練習");
    expect(timeline).not.toContain("入力だけの項目");
    expect(html).not.toContain("外した項目");
    expect(html).not.toContain("以前のシート");
    expect(html).not.toContain("以前の項目");
    expect(html).toContain("連携項目を編集");
  });
  it("distinguishes the stored legacy display policy from an explicit empty timeline selection", () => {
    expect(renderDetail(detail())).toContain("標準の表示（保存済みの非表示設定を使用）");
    expect(renderDetail(detail({ fields: [{ key: "memo", label: "感想", type: "text", showInTimeline: false }] }))).toContain("表示する項目はありません");
  });
  it("keeps disconnected custom forms visible and offers no sheet-based replacement", () => {
    const html = renderDetail(detail({ mode: "off", editable: false, fields: [{ key: "custom", label: "独自の入力項目", type: "text" }] }));
    expect(html).toContain("独自の入力項目");
    expect(html).toContain("スプレッドシートと連携しない");
    expect(html).not.toContain("連携項目を編集");
  });
  it("does not offer editing before the current period has been configured", () => {
    const html = renderDetail(detail({ sheet_name: null, mode: null, editable: false }));
    expect(html).toContain("この期間の設定は未確認です");
    expect(html).not.toContain("連携項目を編集");
  });
  it("identifies fixed middle-long fields without marking optional fields fixed", () => {
    const value = detail({ fields: [
      { key: "strides", label: "流し", sourceHeader: "流し", sourceColumn: 3, type: "number", showInTimeline: true },
      { key: "memo", label: "感想", sourceColumn: 4, type: "text", showInTimeline: true },
    ] });
    value.blocks = ["middle_long"];
    expect(renderDetail(value).match(/（標準）/g)).toHaveLength(2);
  });
});
