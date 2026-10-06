/* Render the actual editor and hook against a deterministic hook runtime. */
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { emptyPerformance, type MeetEventData } from "@/lib/meet-operations";
import { MeetHeatPlan } from "@/lib/meet-heat-plan";
import type { ObEntry } from "@/lib/ob-entries";
import type { ObEventOperation } from "@/lib/ob-operations";

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));
const mocks = vi.hoisted(() => ({
  board: vi.fn(), heatBoard: vi.fn(), fieldBoard: vi.fn(), modal: vi.fn(), guard: vi.fn(), write: vi.fn(), check: vi.fn(), refresh: vi.fn(), onSaved: vi.fn(),
}));
vi.mock("react", async importOriginal => ({
  ...await importOriginal<typeof import("react")>(),
  useState<T>(initial: T | (() => T)) {
    const slot = hooks.cursor++;
    if (!(slot in hooks.values)) hooks.values[slot] = typeof initial === "function" ? (initial as () => T)() : initial;
    return [hooks.values[slot] as T, (next: T | ((before: T) => T)) => {
      hooks.values[slot] = typeof next === "function" ? (next as (before: T) => T)(hooks.values[slot] as T) : next;
    }];
  },
  useRef<T>(initial: T) {
    const slot = hooks.cursor++;
    if (!(slot in hooks.values)) hooks.values[slot] = { current: initial };
    return hooks.values[slot] as { current: T };
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/(app)/ob-entries/operations-actions", () => ({ saveObEventOperation: mocks.write, checkObEventOperation: mocks.check }));
vi.mock("@/components/ui/form-modal", () => ({
  FormModal: ({ children, title }: { children: ReactNode; title: string }) => { mocks.modal(title); return createElement("div", {}, children); },
  FormModalFooter: ({ children }: { children: ReactNode }) => createElement("footer", {}, children),
  FormDraftGuard: (props: unknown) => { mocks.guard(props); return null; },
}));
vi.mock("./MeetHeatBoard", () => ({ MeetHeatBoard: (props: unknown) => { mocks.board(props); mocks.heatBoard(props); return null; } }));
vi.mock("./MeetFieldOrderBoard", () => ({ MeetFieldOrderBoard: (props: unknown) => { mocks.board(props); mocks.fieldBoard(props); return null; } }));
import { ObHeatEditor } from "./ObHeatEditor";

type Board = { data: MeetEventData; onChange: (data: MeetEventData) => void };
const roster = (event: string): ObEntry[] => Array.from({ length: 17 }, (_, i) => ({
  id: `synthetic-${i}`, meet_key: "ob-2026", submitted_name: `合成部員${i}`, grade: "B1", profile_id: null,
  events: [event], qualification_marks: {}, revision: 0, imported_at: "",
}));
function render(event: string, entries: ObEntry[], initial?: ObEventOperation): Board {
  hooks.cursor = 0;
  renderToStaticMarkup(createElement(ObHeatEditor, { event, entries, initial, onSaved: mocks.onSaved, onClose: vi.fn() }));
  return mocks.board.mock.lastCall![0] as Board;
}
beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; vi.clearAllMocks();
  mocks.write.mockImplementation(async input => ({ ok: true, saved: {
    meet_key: "ob-2026", event_name: input.event, revision: (input.revision ?? -1) + 1,
    updated_at: "2026-10-05T00:00:00Z", data: input.data,
  } }));
});

it.each(["男子100m", "女子300m", "男子300mH", "男子1500m", "女子3000m", "男子走り幅跳び", "女子走り高跳び", "男子砲丸投げ"])(
  "leaves every entrant unassigned when first opening %s and does not save on opening",
  event => {
    const entries = roster(event);
    expect(render(event, entries).data.participants).toEqual(entries.map(entry => emptyPerformance(entry.id)));
    expect(mocks.guard).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: false }));
    hooks.values = [];
    expect(render(event, entries).data.participants).toEqual(entries.map(entry => emptyPerformance(entry.id)));
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.check).not.toHaveBeenCalled();
    const field = ["男子走り幅跳び", "女子走り高跳び", "男子砲丸投げ"].includes(event);
    expect(mocks.modal).toHaveBeenLastCalledWith(`${event} · ${field ? "試技順" : "組分け"}`);
    expect(field ? mocks.fieldBoard : mocks.heatBoard).toHaveBeenCalled();
    expect(field ? mocks.heatBoard : mocks.fieldBoard).not.toHaveBeenCalled();
  },
);

it("saves only the manual choice and keeps everyone else unassigned after reopening", async () => {
  const event = "男子100m", entries = roster(event);
  const board = render(event, entries);
  const chosen = entries.slice(0, 2).map(entry => entry.id);
  board.onChange(new MeetHeatPlan(board.data, new Set(entries.map(entry => entry.id))).move(chosen, 2));
  render(event, entries);
  await (mocks.guard.mock.lastCall![0] as { onSave: () => Promise<void> }).onSave();
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(mocks.onSaved).toHaveBeenCalledTimes(1);
  const saved = mocks.onSaved.mock.lastCall![0] as ObEventOperation;
  expect(saved.data.participants.slice(0, 2).map(person => [person.group, person.order])).toEqual([[2, 1], [2, 2]]);
  expect(saved.data.participants.slice(2)).toEqual(entries.slice(2).map(entry => emptyPerformance(entry.id)));
  hooks.values = [];
  expect(render(event, entries, saved).data).toEqual(saved.data);
  expect(mocks.write).toHaveBeenCalledTimes(1);
});

it("preserves saved positions, trials and DNS while newly registered people remain unassigned", () => {
  const event = "男子100m", entries = roster(event);
  const saved: ObEventOperation = {
    meet_key: "ob-2026", event_name: event, revision: 2, updated_at: "2026-10-05T00:00:00Z",
    data: { confirmed: false, participants: [
      { ...emptyPerformance(entries[0].id), group: 2, order: 5, trials: [{ mark: "12.34", status: "valid", wind: "-0.5" }] },
      { ...emptyPerformance(entries[1].id), group: 3, order: 7, status: "DNS" },
    ] },
  };
  expect(render(event, entries.slice(0, 2), saved).data).toEqual(saved.data);
  const added = render(event, entries, saved).data;
  expect(added.participants.slice(0, 2)).toEqual(saved.data.participants);
  expect(added.participants.slice(2)).toEqual(entries.slice(2).map(entry => emptyPerformance(entry.id)));
  expect(mocks.guard).toHaveBeenLastCalledWith(expect.objectContaining({ dirty: false }));
  expect(mocks.write).not.toHaveBeenCalled();
});
