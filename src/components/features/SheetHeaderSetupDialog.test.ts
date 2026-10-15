import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RecordFieldDef } from "@/types";
import { SheetHeaderSetupDialog, type SheetHeaderData } from "./SheetHeaderSetupDialog";

vi.mock("@/components/ui/form-modal", () => ({
  FormModal: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  FormModalFooter: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
  FormDraftGuard: () => null,
}));
vi.mock("@radix-ui/react-dialog", () => ({
  Close: ({ children }: { children: ReactNode }) => createElement(Fragment, null, children),
}));

const changedHeadersMessage = "シートの見出しが変わっています。現在の入力・表示項目を確認してください。";

function field(overrides: Partial<RecordFieldDef> = {}): RecordFieldDef {
  return {
    key: "menu_text", label: "練習内容", type: "text", sourceHeader: "メニュー",
    sourceColumn: 2, showInTimeline: true, ...overrides,
  };
}

function render(columns: SheetHeaderData["columns"], initialFields: RecordFieldDef[]) {
  return renderToStaticMarkup(createElement(SheetHeaderSetupDialog, {
    open: true,
    data: { sheetName: "確認用シート", columns, signature: "確認用の見出し", memoCandidates: [] },
    initialFields,
    isMiddleLong: false,
    busy: false,
    onCancel: vi.fn(),
    onConfirm: vi.fn(),
  }));
}

function choices(html: string, marker: "data-ui-row" | "data-ui-choice-row") {
  return [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(([, attributes]) => attributes.includes(`${marker}=`))
    .map(([, attributes, content]) => ({
      label: content.replace(/<[^>]*>/g, ""),
      selected: attributes.includes('aria-pressed="true"'),
    }));
}

describe("sheet header setup selections", () => {
  it("keeps a uniquely identified moved header selected without selecting its replacement at the old column", () => {
    const html = render([
      { index: 0, label: "日付" },
      { index: 2, label: "考えたこと" },
      { index: 5, label: "メニュー" },
    ], [field({ sourceHeader: " メニュー " })]);

    expect(choices(html, "data-ui-row")).toEqual([
      { label: "考えたこと", selected: false },
      { label: "メニュー", selected: true },
    ]);
    expect(choices(html, "data-ui-choice-row")).toEqual([{ label: "メニュー", selected: true }]);
    expect(html).not.toContain(changedHeadersMessage);
  });

  it("does not transfer an explicit selection to a different header that reuses the same column number", () => {
    const html = render([{ index: 2, label: "メニュー" }], [field({
      key: "pace", label: "保存時のペース", sourceHeader: "ペース",
    })]);

    expect(choices(html, "data-ui-row")).toEqual([{ label: "メニュー", selected: false }]);
    expect(choices(html, "data-ui-choice-row")).toEqual([]);
    expect(html).toContain(changedHeadersMessage);
    expect(html).toContain("先に入力フォームへ項目を追加してください");
  });

  it("leaves duplicate moved headers unselected when their original position no longer identifies either one", () => {
    const html = render([
      { index: 2, label: "考えたこと" },
      { index: 5, label: "メニュー" },
      { index: 7, label: "メニュー" },
    ], [field()]);

    expect(choices(html, "data-ui-row")).toEqual([
      { label: "考えたこと", selected: false },
      { label: "メニュー", selected: false },
      { label: "メニュー", selected: false },
    ]);
    expect(choices(html, "data-ui-choice-row")).toEqual([]);
    expect(html).toContain(changedHeadersMessage);
  });

  it("retains the original matching column when the same header also appears elsewhere", () => {
    const html = render([
      { index: 2, label: "メニュー" },
      { index: 7, label: "メニュー" },
    ], [field()]);

    expect(choices(html, "data-ui-row")).toEqual([
      { label: "メニュー", selected: true },
      { label: "メニュー", selected: false },
    ]);
    expect(choices(html, "data-ui-choice-row")).toEqual([{ label: "メニュー", selected: true }]);
    expect(html).not.toContain(changedHeadersMessage);
  });

  it("preserves input-only selections after a move while keeping hidden fields unselected", () => {
    const html = render([
      { index: 2, label: "メニュー" },
      { index: 5, label: "考えたこと" },
      { index: 8, label: "コメント" },
    ], [
      field({ key: "focus", label: "考えたこと", sourceHeader: "考えたこと", showInTimeline: false }),
      field({ key: "memo", label: "コメント", sourceHeader: "コメント", sourceColumn: 8, hidden: true, showInTimeline: false }),
    ]);

    expect(choices(html, "data-ui-row")).toEqual([
      { label: "メニュー", selected: false },
      { label: "考えたこと", selected: true },
      { label: "コメント", selected: false },
    ]);
    expect(choices(html, "data-ui-choice-row")).toEqual([{ label: "考えたこと", selected: false }]);
    expect(html).not.toContain(changedHeadersMessage);
  });
});
