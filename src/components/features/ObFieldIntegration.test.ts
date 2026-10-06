import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyPerformance, type MeetEventData } from "@/lib/meet-operations";
import type { ObEntry } from "@/lib/ob-entries";
import type { ObEventOperation } from "@/lib/ob-operations";
import type { useObOperationDraft } from "./useObOperationDraft";

const mocks = vi.hoisted(() => ({ selected: undefined as string | undefined, draft: {} as ReturnType<typeof useObOperationDraft> }));
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return { ...actual, useState<T>(initial: T | (() => T)) {
    const [value, setValue] = actual.useState(initial);
    return [initial === null && mocks.selected !== undefined ? mocks.selected : value, setValue];
  } };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./useObOperationDraft", () => ({ useObOperationDraft: () => mocks.draft }));
vi.mock("./ObHeatEditor", () => ({ ObHeatEditor: () => null }));
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
  mocks.selected = undefined;
  mocks.draft = {
    data, change: vi.fn(), dirty: false, busy: false, unconfirmed: false, locked: false, message: "", failed: false, revision: 1, save: vi.fn(),
    review: null, latestData: undefined, choices: {}, setChoices: vi.fn(), applyReview: vi.fn(), reviewing: false, blocked: [], discardPerson: vi.fn(),
  };
});

it("opens trial order from the field overview without a heat count or heat button", () => {
  const html = renderToStaticMarkup(createElement(ObOperations, { ...props, initial: [operation] }));
  const field = html.match(/<section\b[^>]*aria-label="走り幅跳び"[^>]*>[\s\S]*?<\/section>/)?.[0];
  expect(field).toContain('aria-label="男子走り幅跳びの試技順"');
  expect(field).toContain("試技順・DNS");
  expect(field).toContain("順番未定 1人");
  expect(field).not.toContain("組");
});

it("records all legacy field groups in one trial order including DNS and cancelled saved results", () => {
  const html = renderToStaticMarkup(createElement(ObEventOperationsEditor, { event, entries, initial: operation, onSaved: vi.fn(), onClose: vi.fn() }));
  expect(html).not.toContain('aria-label="表示する組"');
  expect(html).not.toContain("組未定");
  for (const [id, placement] of [["dns", "試技順 1番"], ["a", "試技順 2番"], ["b", "試技順 3番"], ["unplaced", "順番未定"]]) {
    expect(html).toMatch(new RegExp(`合成${id}<\\/span><span[^>]*>${placement}`));
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
  expect(overview).toContain('aria-label="男子100mの組分け"');
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
  expect(html).toContain(`保存時の配置：1組・${order === null ? "順番未指定" : "3番"}`);
  expect(html).toContain(`保存時の配置：2組・${order === null ? "順番未指定" : "3番"}`);
});
