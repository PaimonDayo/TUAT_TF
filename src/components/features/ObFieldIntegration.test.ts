import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyPerformance, type MeetEventData } from "@/lib/meet-operations";
import type { ObEntry } from "@/lib/ob-entries";
import type { ObEventOperation } from "@/lib/ob-operations";
import type { useObOperationDraft } from "./useObOperationDraft";
import { obMixedGroupLabel } from "@/lib/ob-mixed-operations";

const mocks = vi.hoisted(() => ({ selected: undefined as string | { family: string; view: "groups" } | undefined, draft: {} as ReturnType<typeof useObOperationDraft>, draftCall: vi.fn(), heatEditor: vi.fn() }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useState<T>(initial: T | (() => T)) {
    const [value, setValue] = actual.useState(initial);
    return [initial === null && mocks.selected !== undefined ? mocks.selected : value, setValue];
  } };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./useObOperationDraft", () => ({ useObOperationDraft: (...args: unknown[]) => { mocks.draftCall(...args); return mocks.draft; } }));
vi.mock("./ObHeatEditor", () => ({ ObHeatEditor: (props: unknown) => { mocks.heatEditor(props); return null; } }));
vi.mock("./ObDutyTable", () => ({ ObDutyTable: () => null }));
vi.mock("@/components/ui/form-modal", () => ({
  FormModal: ({ children, open }: { children: ReactNode; open: boolean }) => open ? createElement("div", {}, children) : null,
  FormModalFooter: ({ children }: { children: ReactNode }) => createElement("footer", {}, children),
  FormDraftGuard: () => null,
}));
import { ObEventOperationsEditor } from "./ObEventOperationsEditor";
import { ObOperations } from "./ObOperations";
import { ObPublicProgram } from "./ObPublicProgram";
import { ObOperationConflict } from "./ObOperationConflict";

const event = "男子走り幅跳び";
const entries: ObEntry[] = ["b", "unplaced", "dns", "a"].map(id => ({
  id, meet_key: "ob-2026", submitted_name: `合成${id}`, grade: "B1", profile_id: null, revision: 0, imported_at: "", qualification_marks: {}, events: id === "b" ? [] : [event],
}));
const data: MeetEventData = { confirmed: false, participants: [
  { ...emptyPerformance("b"), group: 2, order: 1, trials: [{ mark: "5.31", status: "valid", wind: "0.0" }] },
  { ...emptyPerformance("unplaced"), order: 2 },
  { ...emptyPerformance("dns"), group: 1, order: 7, status: "DNS" },
  { ...emptyPerformance("a"), group: 1, order: 7 },
] };
const operation: ObEventOperation = { meet_key: "ob-2026", event_name: event, revision: 1, updated_at: "", data };
const props = { entries, members: [], duties: [], roles: [] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.selected = undefined;
  mocks.draft = {
    data, change: vi.fn(), dirty: false, busy: false, unconfirmed: false, locked: false, message: "", failed: false, revision: 1, save: vi.fn(),
    review: null, latestData: undefined, choices: {}, setChoices: vi.fn(), applyReview: vi.fn(), reviewing: false, blocked: [], discardPerson: vi.fn(),
  };
});

it("opens trial order from the field overview without a heat count or heat button", () => {
  const html = renderToStaticMarkup(createElement(ObOperations, { ...props, initial: [operation] }));
  const field = html.match(/<section\b[^>]*aria-label="走り幅跳び"[^>]*>[\s\S]*?<\/section>/)?.[0];
  expect(field).toContain('aria-label="走り幅跳びの試技順"');
  expect(field).toContain("試技順・DNS");
  expect(field).toContain("順番未定 1人");
  expect(field).not.toContain("組");
});

it("records all legacy field groups in one trial order including DNS and cancelled saved results", () => {
  const html = renderToStaticMarkup(createElement(ObEventOperationsEditor, { event, entries, initial: operation, onSaved: vi.fn(), onClose: vi.fn() }));
  expect(html).not.toContain('aria-label="表示する組"');
  expect(html).not.toContain("組未定");
  for (const [id, placement] of [["dns", "試技順 1番"], ["a", "試技順 2番"], ["b", "試技順 3番"], ["unplaced", "順番未定"]]) {
    expect(html).toMatch(new RegExp(`合成${id}<\\/span><span[^>]*>男子 · ${placement}`));
  }
  expect(html.indexOf("合成dns")).toBeLessThan(html.indexOf("合成a"));
  expect(html.indexOf("合成a")).toBeLessThan(html.indexOf("合成b"));
  expect(html).toContain("5.31");
  expect(html).toContain('aria-label="合成dnsの出場状況"');
});

it("shows the same field ordinals in the public program and retains unplaced people", () => {
  mocks.selected = "走り幅跳び";
  const html = renderToStaticMarkup(createElement(ObPublicProgram, { ...props, operations: [operation] }));
  expect(html).toContain("4人・試技順と記録");
  expect(html).not.toContain("組未定");
  expect(html).not.toContain("組分けと記録");
  const rows = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? [];
  for (const [id, placement] of [["dns", "試技順 1番"], ["a", "試技順 2番"], ["b", "試技順 3番"], ["unplaced", "順番未定"]]) {
    const row = rows.find(row => row.includes(`合成${id}<`));
    expect(row).toContain(placement);
  }
  expect(html.indexOf("合成dns")).toBeLessThan(html.indexOf("合成a"));
  expect(html.indexOf("合成a")).toBeLessThan(html.indexOf("合成b"));
  expect(html).toContain("登録取消・記録保持");
  expect(html).toContain("5.31");
});

it("retains track heat filters and heat labels", () => {
  const track = "男子100m";
  const roster = entries.map(entry => ({ ...entry, events: [track] }));
  const html = renderToStaticMarkup(createElement(ObEventOperationsEditor, { event: track, entries: roster, onSaved: vi.fn(), onClose: vi.fn() }));
  expect(html).toContain('aria-label="表示する組"');
  expect(html).toContain("2組 1番");
  expect(html).not.toContain("試技順");
  const overview = renderToStaticMarkup(createElement(ObOperations, { ...props, entries: roster, initial: [{ ...operation, event_name: track }] }));
  expect(overview).toContain('aria-label="100mの組分け"');
  expect(overview).toContain("組分け・DNS");
});

it("compares field conflict choices using each full snapshot instead of an individual's saved slot", () => {
  const own: MeetEventData = { confirmed: false, participants: [
    { ...emptyPerformance("a"), group: 3, order: 1 }, { ...emptyPerformance("b"), group: 2, order: 1 }, { ...emptyPerformance("c"), group: 1, order: 1 },
  ] };
  const current: MeetEventData = { confirmed: false, participants: [
    { ...emptyPerformance("a"), group: 1, order: 9 }, { ...emptyPerformance("b"), group: 1, order: 1 }, { ...emptyPerformance("c"), group: 3, order: 1 },
  ] };
  mocks.draft.data = own;
  mocks.draft.latestData = current;
  mocks.draft.review = { data: own, conflicts: [{ key: "a:position", entryId: "a", field: "position", own: own.participants[0], current: current.participants[0] }] };
  const html = renderToStaticMarkup(createElement(ObOperationConflict, { draft: mocks.draft, entries, event }));
  expect(html).toContain("合成a · 試技順");
  expect(html).toContain("保存されている内容</strong>試技順 2番");
  expect(html).toContain("自分の入力</strong>試技順 3番");
  expect(html).not.toContain("9番");
  expect(html).not.toContain("1組");
});

it.each([3, null])("distinguishes old field storage conflicts with the same visible ordinal (order %s)", order => {
  const own: MeetEventData = { confirmed: false, participants: [{ ...emptyPerformance("a"), group: 2, order }] };
  const current: MeetEventData = { confirmed: false, participants: [{ ...emptyPerformance("a"), group: 1, order }] };
  mocks.draft.data = own;
  mocks.draft.latestData = current;
  mocks.draft.review = { data: own, conflicts: [{ key: "a:position", entryId: "a", field: "position", own: own.participants[0], current: current.participants[0] }] };
  const html = renderToStaticMarkup(createElement(ObOperationConflict, { draft: mocks.draft, entries, event }));
  expect(html).toContain(order === null ? "順番未定" : "試技順 1番");
  expect(html).toContain(`保存時の配置：男子1組・${order === null ? "順番未指定" : "3番"}`);
  expect(html).toContain(`保存時の配置：男子2組・${order === null ? "順番未指定" : "3番"}`);
});

const mixedEntries: ObEntry[] = ["m", "w"].map(id => ({ ...entries[0], id, submitted_name: id === "m" ? "男子合成" : "女子合成", events: [`${id === "m" ? "男子" : "女子"}100m`] }));
const mixedOperations: ObEventOperation[] = ["男子", "女子"].map((division, index) => ({ ...operation, event_name: `${division}100m`, data: { confirmed: false, participants: [{ ...emptyPerformance(index === 0 ? "m" : "w"), group: 1, order: 1 }] } }));

it("offers one family heat entrance while retaining separate sex recording entrances and existing heat identities", () => {
  const html = renderToStaticMarkup(createElement(ObOperations, { ...props, entries: mixedEntries, initial: mixedOperations }));
  expect(html.match(/aria-label="100mの組分け"/g)).toHaveLength(1);
  expect(html).toContain('aria-label="男子100mの記録"');
  expect(html).toContain('aria-label="女子100mの記録"');
  expect(html).toContain("男子 1組 · 女子 1組");
  expect(html).not.toContain("混合 1組");
  mocks.selected = { family: "100m", view: "groups" };
  renderToStaticMarkup(createElement(ObOperations, { ...props, entries: mixedEntries, initial: mixedOperations }));
  expect(mocks.heatEditor).toHaveBeenCalledWith(expect.objectContaining({ family: "100m", initial: mixedOperations }));
});

it("keeps male and female heat one separate in the public program without modifying source data", () => {
  mocks.selected = "100m";
  const snapshot = JSON.stringify(mixedOperations);
  const html = renderToStaticMarkup(createElement(ObPublicProgram, { ...props, entries: mixedEntries, operations: mixedOperations }));
  const rows = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? [];
  expect(rows.find(row => row.includes("男子合成"))).toContain("男子1組・1レーン");
  expect(rows.find(row => row.includes("女子合成"))).toContain("女子1組・1レーン");
  expect(html).not.toContain("混合1組");
  expect(JSON.stringify(mixedOperations)).toBe(snapshot);
});

it("shows both sex badges in an explicitly mixed physical heat with their original results", () => {
  mocks.selected = "100m";
  const saved = mixedOperations.map((operation, index) => ({ ...operation, data: { ...operation.data, participants: operation.data.participants.map(person => ({ ...person, heatScope: "混合" as const, order: index + 1, trials: [{ mark: index === 0 ? "12.34" : "13.45", status: "valid" as const, wind: "" }] })) } }));
  const html = renderToStaticMarkup(createElement(ObPublicProgram, { ...props, entries: mixedEntries, operations: saved }));
  const rows = html.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? [];
  expect(rows.find(row => row.includes("男子合成"))).toContain("男子</span>");
  expect(rows.find(row => row.includes("女子合成"))).toContain("女子</span>");
  expect(rows.find(row => row.includes("男子合成"))).toContain("混合1組・1レーン");
  expect(rows.find(row => row.includes("女子合成"))).toContain("混合1組・2レーン");
  expect(html).toContain("12.34"); expect(html).toContain("13.45");
});

it("shows physical scope filters and original-source conflict choices when raw group numbers are equal", () => {
  const current = { ...emptyPerformance("m"), group: 1, order: 1 };
  const own = { ...current, heatScope: "混合" as const };
  mocks.draft.data = { confirmed: false, participants: [own, { ...emptyPerformance("another"), group: 1, order: 2 }] };
  mocks.draft.latestData = { confirmed: false, participants: [current] };
  mocks.draft.review = { data: mocks.draft.data, conflicts: [{ key: "m:position", entryId: "m", field: "position", own, current }] };
  const roster = [...mixedEntries, { ...mixedEntries[0], id: "another", submitted_name: "同じ番号の別組" }];
  const html = renderToStaticMarkup(createElement(ObEventOperationsEditor, { event: "男子100m", entries: roster, initial: mixedOperations[0], operations: mixedOperations, onSaved: vi.fn(), onClose: vi.fn() }));
  expect(html).toContain('aria-label="表示する組"');
  expect(html).toContain("保存されている内容</strong>男子1組 1番");
  expect(html).toContain("自分の入力</strong>混合1組 1番");
  expect(html).toContain("男子 · 混合1組 1番");
  expect(html).toContain("男子 · 男子1組 2番");
  expect(mocks.draft.change).not.toHaveBeenCalled();
});

it("uses the same shared field ordinal in the source recording form and public program without changing its save event", () => {
  const roster = mixedEntries.map((entry, index) => ({ ...entry, events: [`${index === 0 ? "男子" : "女子"}走り幅跳び`] }));
  const saved = mixedOperations.map((operation, index) => ({ ...operation, event_name: roster[index].events[0], data: { confirmed: false, participants: [{ ...emptyPerformance(roster[index].id), group: 1, order: index === 0 ? 2 : 1, heatScope: "混合" as const }] } }));
  mocks.draft.data = saved[0].data;
  const record = renderToStaticMarkup(createElement(ObEventOperationsEditor, { event, entries: roster, initial: saved[0], operations: saved, onSaved: vi.fn(), onClose: vi.fn() }));
  expect(record).toContain("男子 · 試技順 2番");
  expect(record).not.toContain("女子合成");
  expect(mocks.draftCall).toHaveBeenCalledWith(event, roster, saved[0], expect.any(Function));
  expect(mocks.draft.change).not.toHaveBeenCalled();
  mocks.selected = "走り幅跳び";
  const program = renderToStaticMarkup(createElement(ObPublicProgram, { ...props, entries: roster, operations: saved }));
  const rows = program.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) ?? [];
  expect(rows.find(row => row.includes("男子合成"))).toContain("試技順 2番");
  expect(rows.find(row => row.includes("女子合成"))).toContain("試技順 1番");
});

it("labels projected conflict groups without exposing virtual group numbers", () => {
  const own = { ...emptyPerformance("a"), group: 199, order: 1 };
  const current = { ...own, group: 1 };
  mocks.draft.review = { data: mocks.draft.data, conflicts: [{ key: "a:position", entryId: "a", field: "position", own, current }] };
  const html = renderToStaticMarkup(createElement(ObOperationConflict, { draft: mocks.draft, entries, event: "100m", groupLabel: obMixedGroupLabel }));
  expect(html).toContain("男子1組 1番");
  expect(html).toContain("混合1組 1番");
  expect(html).not.toContain("199組");
});

it("offers the results workbook only when there is an event to export", () => {
  const html = renderToStaticMarkup(createElement(ObOperations, { ...props, initial: [operation] }));
  expect(html).toContain("スプレッドシートに出力");
  expect(html).toContain("プログラムと種目ごとのスタートリストを、シートに分けて保存します");
  const empty = renderToStaticMarkup(createElement(ObOperations, { ...props, entries: [], initial: [] }));
  expect(empty).toContain("出場登録がある種目はありません");
  expect(empty).not.toContain("スプレッドシートに出力");
});
