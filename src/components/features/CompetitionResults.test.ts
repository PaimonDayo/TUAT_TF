import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ParsedProgramRow } from "@/lib/competition-program";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";

const state = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useState(initial: unknown) {
    const index = state.cursor++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (value: unknown) => { state.values[index] = value; }];
  },
}));
import { CompetitionResultRow, CompetitionResults } from "./CompetitionResults";

function row(eventLabel: string, sortOrder: number, overrides: Partial<ParsedProgramRow> = {}): ParsedProgramRow {
  return {
    eventDate: "2026-10-13", block: "track", sortOrder, timeLabel: "09:00", roundKey: eventLabel,
    eventLabel, status: "確定", tuatEntries: [{ id: eventLabel, name: `${eventLabel}の選手`, grade: "B1", heat: 1, lane: 2, bib: null, result: { place: "1", record: "12.34" } }],
    ...overrides,
  };
}
const rows = [
  row("女子100m", 1),
  row("男子100m", 2),
  row("男子オープン100m", 3),
  row("女子走り幅跳び", 4, { block: "field", timeLabel: "10:00" }),
  row("男女混合4×100mR", 5),
  row("100m", 6),
  row("男子1500m", 7, { eventDate: "2026-10-14", timeLabel: "11:00" }),
];

function findElement<P>(node: ReactNode, type: ReactElement["type"]): ReactElement<P> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) { const found = findElement<P>(child, type); if (found) return found; }
  } else if (isValidElement<{ children?: ReactNode }>(node)) {
    if (node.type === type) return node as ReactElement<P>;
    return findElement<P>(node.props.children, type);
  }
}
function view(input = rows) {
  state.cursor = 0;
  const element = CompetitionResults({ rows: input });
  return { element, html: renderToStaticMarkup(element) };
}
function select(element: ReactNode, label: string) {
  const control = findElement<{ items: { key: string; label: string }[]; onChange: (key: string) => void }>(element, SegmentedControl)!;
  control.props.onChange(control.props.items.find(item => item.label === label)!.key);
}
function search(element: ReactNode, value: string) {
  findElement<{ onChange: (event: { target: { value: string } }) => void }>(element, Input)!.props.onChange({ target: { value } });
}
beforeEach(() => { state.values = []; state.cursor = 0; });

it("separates men, women, mixed and unclassified results within each date without merging official rounds", () => {
  const before = structuredClone(rows);
  const { html } = view();
  expect(html).toContain(">全て</button>");
  expect(html).toContain(">男子</button>");
  expect(html).toContain(">女子</button>");
  expect(html).toContain(">混合</button>");
  expect(html).toContain(">男子</h3>");
  expect(html).toContain(">女子</h3>");
  expect(html).toContain(">混合</h3>");
  expect(html).toContain(">区分なし</h3>");
  expect(html.indexOf("男子100m")).toBeLessThan(html.indexOf("女子100m"));
  expect(html.indexOf("男子OP100m")).toBeLessThan(html.indexOf(">女子</h3>"));
  expect(html).toContain("女子走り幅跳び");
  expect(html).toContain("10月13日(火)");
  expect(html).toContain("10月14日(水)");
  expect(html).toContain("11:00");
  expect((html.match(/出場 1件/g) ?? [])).toHaveLength(rows.length);
  expect(rows).toEqual(before);
});

it("lets the user switch gender and search people, grades or events, then restore all results", () => {
  const first = view(); select(first.element, "女子");
  let current = view();
  expect(current.html).toContain("女子100m"); expect(current.html).toContain("女子走り幅跳び");
  expect(current.html).not.toContain("男子100m"); expect(current.html).not.toContain("男女混合");
  search(current.element, "走り幅跳びの選手"); current = view();
  expect(current.html).toContain("女子走り幅跳び"); expect(current.html).not.toContain("女子100m");
  search(current.element, "B1"); current = view();
  expect(current.html).toContain("女子100m"); expect(current.html).toContain("女子走り幅跳び");
  search(current.element, "1500m"); current = view();
  expect(current.html).toContain("条件に合う結果はありません");
  select(current.element, "男子"); current = view();
  expect(current.html).toContain("男子1500m"); expect(current.html).not.toContain("男子100m");
  search(current.element, ""); current = view(); select(current.element, "混合"); current = view();
  expect(current.html).toContain("男女混合4×100mR"); expect(current.html).not.toContain("男子100m"); expect(current.html).not.toContain("女子100m");
  select(current.element, "全て");
  expect((view().html.match(/出場 1件/g) ?? [])).toHaveLength(rows.length);
});

it("restores all results when refreshed data no longer contains the selected division", () => {
  const first = view(); select(first.element, "女子");
  const { html } = view([rows[1], rows[5]]);
  expect(html).toContain("男子100m"); expect(html).toContain(">100m</span>");
  expect(html).toMatch(/aria-pressed="true"[^>]*>全て<\/button>/);
  expect(html).not.toContain("条件に合う結果はありません");
});

it("offers only classifications present in the data and retains unspecified official events", () => {
  const { html } = view([rows[0], rows[5]]);
  expect(html).toContain(">全て</button>"); expect(html).toContain(">女子</button>");
  expect(html).not.toContain(">男子</button>"); expect(html).not.toContain(">混合</button>");
  expect(html).toContain(">区分なし</h3>"); expect((html.match(/出場 1件/g) ?? [])).toHaveLength(2);
  state.values = [];
  const unspecified = view([rows[5]]).html;
  expect(unspecified).toContain("100mの選手"); expect(unspecified).not.toContain(">全て</button>");
});

it("keeps official school/open rounds and mixed heats under their event's gender", () => {
  const official = [
    row("男子対校 100m決勝(2組)", 1), row("女子対校 100m決勝(2組)", 2),
    row("男子オープン 100m決勝", 3), row("男子1500m（混合組）", 4), row("混合4×100mR", 5),
  ];
  const first = view(official); select(first.element, "男子");
  let current = view(official);
  expect(current.html).toContain("男子 100m 決勝"); expect(current.html).toContain("男子OP 100m 決勝");
  expect(current.html).toContain("男子1500m"); expect(current.html).not.toContain("女子 100m 決勝");
  expect((current.html.match(/出場 1件/g) ?? [])).toHaveLength(3);
  select(current.element, "混合"); current = view(official);
  expect(current.html).toContain("混合4×100mR"); expect(current.html).not.toContain("男子1500m");
  expect((current.html.match(/出場 1件/g) ?? [])).toHaveLength(1);
});

it("opens results with distinct appearances, official ranks, positions, wind and DNS intact", () => {
  const input = row("男子100m", 1, { tuatEntries: [
    { id: "first", name: "同じ選手（1件目）", grade: "M2", heat: 2, lane: 3, bib: null, positionLabel: "混合2組 3番", separateResult: true, details: ["試技1: 12.34（風 +1.0）"], result: { place: "2", record: "12.34", wind: "+1.0" } },
    { id: "second", name: "同じ選手（2件目）", grade: "M2", heat: 2, lane: 4, bib: null, positionLabel: "混合2組 4番", separateResult: true, result: { place: "1", record: "12.34", wind: "+1.0" } },
    { id: "dns", name: "欠場した選手", grade: "B3", heat: null, lane: null, bib: null, positionLabel: "組未定", details: ["出場取消済み"], result: { place: null, record: "DNS" } },
  ] });
  const before = structuredClone(input);
  state.cursor = 0; const element = CompetitionResultRow({ row: input });
  const collapsed = renderToStaticMarkup(element);
  expect(collapsed).toContain("2位 12.34 風 +1.0"); expect(collapsed).toContain("1位 12.34 風 +1.0");
  findElement<{ onClick: () => void }>(element, "button")!.props.onClick();
  state.cursor = 0; const opened = renderToStaticMarkup(CompetitionResultRow({ row: input }));
  for (const text of ["同じ選手（1件目）", "同じ選手（2件目）", "混合2組 3番", "混合2組 4番", "2位 12.34 風 +1.0", "1位 12.34 風 +1.0", "試技1: 12.34（風 +1.0）", "組未定", "DNS", "出場取消済み"]) expect(opened).toContain(text);
  expect(input).toEqual(before);
});

it("keeps the existing no-results state", () => {
  expect(renderToStaticMarkup(createElement(CompetitionResults, { rows: [] }))).toContain("まだこの大会の結果はありません");
});
