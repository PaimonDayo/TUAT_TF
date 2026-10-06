import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { useObOperationDraft } from "./useObOperationDraft";
import { emptyPerformance } from "@/lib/meet-operations";
import type { ObEntry } from "@/lib/ob-entries";

const mocks = vi.hoisted(() => ({ draft: {} as ReturnType<typeof useObOperationDraft>, guard: vi.fn(), board: vi.fn() }));
vi.mock("./useObOperationDraft", () => ({ useObOperationDraft: () => mocks.draft }));
vi.mock("@/components/ui/form-modal", () => ({
  FormModal: ({ children }: { children: ReactNode }) => createElement("div", {}, children),
  FormModalFooter: ({ children }: { children: ReactNode }) => createElement("footer", {}, children),
  FormDraftGuard: (props: unknown) => { mocks.guard(props); return null; },
}));
vi.mock("./MeetHeatBoard", () => ({ MeetHeatBoard: (props: unknown) => { mocks.board(props); return null; } }));
vi.mock("./MeetFieldOrderBoard", () => ({ MeetFieldOrderBoard: (props: unknown) => { mocks.board(props); return null; } }));
import { ObEventOperationsEditor } from "./ObEventOperationsEditor";
import { ObHeatEditor } from "./ObHeatEditor";

const entry: ObEntry = { id: "e", meet_key: "ob-2026", submitted_name: "合成部員", grade: "B1", profile_id: null, revision: 0, imported_at: "", qualification_marks: {}, events: ["男子100m"] };
const props = { event: "男子100m", entries: [entry], onSaved: vi.fn(), onClose: vi.fn(), onAddEntry: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.draft = {
    data: { confirmed: false, participants: [{ ...emptyPerformance(entry.id), group: 1, order: 1 }] },
    change: vi.fn(), dirty: true, busy: false, unconfirmed: true, locked: true,
    message: "結果を確認してください", failed: true, revision: 2, save: vi.fn(),
    review: null, choices: {}, setChoices: vi.fn(), applyReview: vi.fn(), reviewing: false, latestData: undefined,
    blocked: [], discardPerson: vi.fn(),
  };
});

it.each([ObEventOperationsEditor, ObHeatEditor])("locks the form and close guard while leaving read-only confirmation available", (Editor) => {
  const html = renderToStaticMarkup(createElement(Editor, props));
  expect(mocks.guard).toHaveBeenCalledWith(expect.objectContaining({ busy: true, dirty: true }));
  const confirm = html.match(/<button\b[^>]*>保存結果を確認<\/button>/)?.[0];
  expect(confirm).toBeDefined();
  expect(confirm).not.toContain('disabled=""');
  const addEntry = html.match(/<button\b[^>]*>出場者を追加<\/button>/)?.[0];
  expect(addEntry).toContain('disabled=""');
  if (Editor === ObHeatEditor) expect(mocks.board).toHaveBeenCalledWith(expect.objectContaining({ disabled: true }));
  else {
    const time = html.match(/<input\b[^>]*aria-label="合成部員のタイム"[^>]*>/)?.[0];
    expect(time).toContain('disabled=""');
    const status = html.match(/<select\b[^>]*>/)?.[0];
    expect(status).toContain('disabled=""');
  }
});

it.each([ObEventOperationsEditor, ObHeatEditor])("disables confirmation while its read is pending", (Editor) => {
  mocks.draft.busy = true;
  const html = renderToStaticMarkup(createElement(Editor, props));
  expect(html.match(/<button\b[^>]*>確認中…<\/button>/)?.[0]).toContain('disabled=""');
  expect(mocks.guard).toHaveBeenCalledWith(expect.objectContaining({ busy: true }));
});

it("locks field trial order while confirming an uncertain save", () => {
  renderToStaticMarkup(createElement(ObHeatEditor, { ...props, event: "男子走り幅跳び" }));
  expect(mocks.board).toHaveBeenCalledWith(expect.objectContaining({ disabled: true }));
  expect(mocks.guard).toHaveBeenCalledWith(expect.objectContaining({ busy: true }));
});
