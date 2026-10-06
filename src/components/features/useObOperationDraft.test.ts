/* eslint-disable react-hooks/rules-of-hooks -- Actual hook is invoked against a deterministic hook runtime to verify save sequences. */
import { beforeEach, expect, it, vi } from "vitest";
import { emptyPerformance, type MeetEventData } from "@/lib/meet-operations";
import type { ObEventOperation } from "@/lib/ob-operations";
import type { ObEntry } from "@/lib/ob-entries";

const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));
const mocks = vi.hoisted(() => ({ write: vi.fn(), check: vi.fn(), refresh: vi.fn(), onSaved: vi.fn() }));
vi.mock("react", () => ({
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
import { useObOperationDraft } from "./useObOperationDraft";

const entries: ObEntry[] = ["a", "b"].map(id => ({ id, meet_key: "ob-2026", submitted_name: `合成${id}`, grade: "B1", profile_id: null, events: ["男子100m"], qualification_marks: {}, revision: 0, imported_at: "" }));
const initial: ObEventOperation = { meet_key: "ob-2026", event_name: "男子100m", revision: 2, updated_at: "2026-10-05T00:00:00Z", data: {
  confirmed: false, participants: [
    { ...emptyPerformance("a"), group: 1, order: 1 }, { ...emptyPerformance("b"), group: 1, order: 2 },
  ],
} };
function render(source = initial, roster = entries) {
  hooks.cursor = 0;
  return useObOperationDraft("男子100m", roster, source, mocks.onSaved);
}
function entered(): MeetEventData {
  return { ...initial.data, participants: initial.data.participants.map(person => person.entryId === "a" ? { ...person, trials: [{ mark: "12.34", status: "valid" as const, wind: "" }] } : person) };
}
beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; vi.clearAllMocks();
  mocks.write.mockResolvedValue({ ok: true, saved: { ...initial, revision: 3, data: entered() } });
  mocks.check.mockResolvedValue({ ok: false, message: "保存結果を確認できませんでした" });
});

it("opens an unsaved event without marking the displayed roster as an edit or writing it", async () => {
  const fresh = () => {
    hooks.cursor = 0;
    return useObOperationDraft("男子100m", entries, undefined, mocks.onSaved);
  };
  expect(fresh().data.participants).toEqual(entries.map(entry => emptyPerformance(entry.id)));
  expect(fresh().dirty).toBe(false);
  await fresh().save();
  expect(mocks.write).not.toHaveBeenCalled();
  expect(mocks.check).not.toHaveBeenCalled();
});

it("keeps roster-only additions clean and sends the exact saved base only after a real edit", async () => {
  render();
  const roster = [...entries, { ...entries[0], id: "new" }];
  const displayed = render(initial, roster);
  expect(displayed.dirty).toBe(false);
  await displayed.save();
  expect(mocks.write).not.toHaveBeenCalled();
  const edited = { ...displayed.data, participants: displayed.data.participants.map(person => person.entryId === "new" ? { ...person, group: 2, order: 1 } : person) };
  displayed.change(edited);
  expect(render(initial, roster).dirty).toBe(true);
  mocks.write.mockResolvedValueOnce({ ok: true, saved: { ...initial, revision: 3, data: edited } });
  await render(initial, roster).save();
  expect(mocks.write).toHaveBeenCalledWith({ event: "男子100m", revision: initial.revision, baseData: initial.data, data: edited });
  expect(render(initial, roster).dirty).toBe(false);
});

it("returns to clean after undo or moving someone back while an added entrant remains displayed", async () => {
  const roster = [...entries, { ...entries[0], id: "new" }];
  const original = render(initial, roster).data;
  render(initial, roster).change({ ...original, participants: original.participants.map(person => person.entryId === "a" ? { ...person, group: 2, order: 7 } : person) });
  expect(render(initial, roster).dirty).toBe(true);
  render(initial, roster).change(original);
  expect(render(initial, roster).dirty).toBe(false);
  await render(initial, roster).save();
  expect(mocks.write).not.toHaveBeenCalled();
});

it("ignores participant order, object key order and an empty pending trial tail", async () => {
  const saved = { ...initial, data: entered() };
  render(saved);
  const equivalent: MeetEventData = {
    confirmed: false,
    participants: [...saved.data.participants].reverse().map(person => ({
      trials: person.trials.map(trial => ({ wind: trial.wind, status: trial.status, mark: trial.mark })).concat([{ wind: "", status: "pending", mark: "" }]),
      status: person.status, order: person.order, group: person.group, entryId: person.entryId,
    })),
  };
  render(saved).change(equivalent);
  expect(render(saved).dirty).toBe(false);
  await render(saved).save();
  expect(mocks.write).not.toHaveBeenCalled();
});

it("does not call a roster-driven confirmation reset a local edit but tracks an explicit confirmation change", () => {
  const saved = { ...initial, data: { confirmed: true, participants: initial.data.participants.map(person => ({ ...person, trials: [{ mark: "12.34", status: "valid" as const, wind: "" }] })) } };
  expect(render(saved).dirty).toBe(false);
  render(saved).change({ ...saved.data, confirmed: false });
  expect(render(saved).dirty).toBe(true);
  render(saved).change(saved.data);
  expect(render(saved).dirty).toBe(false);
  const roster = [...entries, { ...entries[0], id: "new" }];
  expect(render(saved, roster).data.confirmed).toBe(false);
  expect(render(saved, roster).dirty).toBe(false);
});

it("guards a real edit to an absent entrant and becomes clean after explicitly discarding that edit", async () => {
  const roster = entries.map(entry => ({ ...entry, absent: entry.id === "a" }));
  expect(render(initial, roster).dirty).toBe(false);
  render(initial, roster).change(entered());
  expect(render(initial, roster).dirty).toBe(true);
  expect(render(initial, roster).blocked.map(person => person.entryId)).toEqual(["a"]);
  await render(initial, roster).save();
  expect(render(initial, roster).failed).toBe(true);
  expect(mocks.write).not.toHaveBeenCalled();
  render(initial, roster).discardPerson("a");
  expect(render(initial, roster).dirty).toBe(false);
  expect(render(initial, roster).blocked).toEqual([]);
});

it("reads again without rewriting after the save response was lost", async () => {
  mocks.write.mockRejectedValueOnce(new Error("response lost after commit"));
  render().change(entered());
  await render().save();
  await render().save();
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(mocks.check).toHaveBeenCalledTimes(2);
  expect(mocks.onSaved).not.toHaveBeenCalled();
});

it("holds the submitted snapshot and refuses input, discard and refresh changes until it is confirmed", async () => {
  mocks.write.mockRejectedValueOnce(new Error("response lost after commit"));
  render().change(entered());
  await render().save();
  let draft = render();
  expect(draft).toMatchObject({ busy: false, unconfirmed: true, locked: true, failed: true, dirty: true });
  draft.change({ ...entered(), confirmed: true });
  draft.discardPerson("a");
  const remote = { ...initial, revision: 4, data: { ...initial.data, participants: [...initial.data.participants, emptyPerformance("new")] } };
  draft = render(remote, [...entries, { ...entries[0], id: "new" }]);
  expect(draft.data).toEqual(entered());
  await draft.save();
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(mocks.check.mock.calls[1][0]).toEqual({ event: "男子100m", revision: 2, data: entered(), baseData: initial.data });
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("adopts the confirmed latest operation including independent changes and new entrants", async () => {
  mocks.write.mockResolvedValueOnce({ ok: false, uncertain: true });
  mocks.check.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, saved: {
    ...initial, revision: 5, data: { ...entered(), participants: [
      entered().participants[0], { ...initial.data.participants[1], trials: [{ mark: "13.45", status: "valid", wind: "" }] }, emptyPerformance("new"),
    ] },
  } });
  render().change(entered());
  await render().save();
  await render().save();
  const draft = render();
  expect(draft).toMatchObject({ unconfirmed: false, locked: false, dirty: false, failed: false, revision: 5, message: "保存しました" });
  expect(draft.data.participants.map(person => person.entryId)).toEqual(["a", "b", "new"]);
  expect(draft.data.participants[1].trials[0].mark).toBe("13.45");
  expect(mocks.onSaved).toHaveBeenCalledTimes(1);
  expect(mocks.onSaved.mock.calls[0][0].data).toEqual(draft.data);
  expect(mocks.write).toHaveBeenCalledTimes(1);
});

it("keeps the operation uncertain if confirmation itself cannot be read", async () => {
  mocks.write.mockRejectedValueOnce(new Error("response lost"));
  mocks.check.mockRejectedValue(new Error("read unavailable"));
  render().change(entered());
  await render().save();
  await render().save();
  expect(render()).toMatchObject({ unconfirmed: true, locked: true, busy: false, failed: true });
  expect(render().data).toEqual(entered());
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect(mocks.check).toHaveBeenCalledTimes(2);
});

it("permits editing and explicit retry after a definitive rejected transaction", async () => {
  mocks.write.mockResolvedValueOnce({ ok: false, message: "入力を確認してください" });
  render().change(entered());
  await render().save();
  expect(render()).toMatchObject({ unconfirmed: false, locked: false, failed: true, dirty: true });
  const corrected = { ...entered(), participants: [{ ...entered().participants[0], trials: [{ mark: "12.45", status: "valid" as const, wind: "" }] }, initial.data.participants[1]] };
  render().change(corrected);
  expect(render().data).toEqual(corrected);
  await render().save();
  expect(mocks.write).toHaveBeenCalledTimes(2);
  expect(mocks.check).not.toHaveBeenCalled();
});

it("preserves the existing explicit conflict review instead of treating a rollback as uncertain", async () => {
  const latest = { ...initial, revision: 3, data: { ...initial.data, participants: [{ ...initial.data.participants[0], trials: [{ mark: "12.99", status: "valid" as const, wind: "" }] }, initial.data.participants[1]] } };
  mocks.write.mockResolvedValueOnce({ ok: false, latest, message: "変更箇所を確認してください" });
  render().change(entered());
  await render().save();
  expect(render()).toMatchObject({ unconfirmed: false, locked: false, reviewing: true, dirty: true });
  expect(render().review?.conflicts.map(conflict => conflict.key)).toEqual(["a:trials"]);
  expect(render().latestData).toBe(latest.data);
  expect(render().data.participants[0].trials[0].mark).toBe("12.34");
  expect(render().latestData?.participants[0].trials[0].mark).toBe("12.99");
  expect(mocks.check).not.toHaveBeenCalled();
});

it("prevents a second save and input changes while the first request is pending", async () => {
  let respond!: (value: unknown) => void;
  mocks.write.mockReturnValue(new Promise(resolve => { respond = resolve; }));
  render().change(entered());
  const save = render().save();
  expect(render()).toMatchObject({ busy: true, locked: true });
  render().change({ ...entered(), confirmed: true });
  await render().save();
  expect(render().data).toEqual(entered());
  expect(mocks.write).toHaveBeenCalledTimes(1);
  respond({ ok: true, saved: { ...initial, revision: 3, data: entered() } });
  await save;
  expect(render()).toMatchObject({ locked: false, busy: false, unconfirmed: false, dirty: false });
});
