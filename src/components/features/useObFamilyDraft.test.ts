/* eslint-disable react-hooks/rules-of-hooks -- Invoke the actual hook in a deterministic runtime to test complete save/recovery sequences. */
import { beforeEach, expect, it, vi } from "vitest";
import { emptyPerformance, type MeetEventData, type MeetPerformance } from "@/lib/meet-operations";
import type { ObEntry } from "@/lib/ob-entries";
import type { ObEventOperation } from "@/lib/ob-operations";
import type { ObMixedInput } from "@/lib/ob-mixed-operations";

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
vi.mock("@/app/(app)/ob-entries/operations-actions", () => ({ saveObFamilyOperation: mocks.write, checkObFamilyOperation: mocks.check }));
import { useObFamilyDraft } from "./useObFamilyDraft";

const male = "男子100m", female = "女子100m";
const a = "10000000-0000-4000-8000-000000000001", b = "10000000-0000-4000-8000-000000000002";
const entry = (id: string, event = male): ObEntry => ({ id, meet_key: "ob-2026", submitted_name: `合成${id}`, grade: "B1", profile_id: null, events: [event], qualification_marks: {}, revision: 0, imported_at: "" });
const placed = (id: string): MeetPerformance => ({ ...emptyPerformance(id), group: 1, order: 1, trials: [{ mark: "12.34", status: "valid", wind: "" }] });
const operation = (event: string, person: MeetPerformance, revision = 3, confirmed = true): ObEventOperation => ({ meet_key: "ob-2026", event_name: event, revision, data: { participants: [person], confirmed }, updated_at: "2026-10-07T00:00:00Z" });
const entries = [entry(a), entry(b, female)];
const initial = [operation(male, placed(a)), operation(female, placed(b), 5)];
type Attempt = { family: string; operations: ObMixedInput[] };
const savedAttempt = (attempt: Attempt): ObEventOperation[] => attempt.operations.map(request => ({ meet_key: "ob-2026", event_name: request.event, revision: (request.revision ?? -1) + 1, data: request.data, updated_at: "2026-10-07T01:00:00Z" }));
function render(source = initial, roster = entries, family = "100m") {
  hooks.cursor = 0;
  return useObFamilyDraft(family, roster, source, mocks.onSaved);
}
function mixed(): MeetEventData {
  const data = render().data;
  return { ...data, participants: data.participants.map((person, index) => ({ ...person, group: 199, order: index + 1 })) };
}
beforeEach(() => {
  hooks.values = []; hooks.cursor = 0; vi.clearAllMocks();
  mocks.write.mockImplementation(async (attempt: Attempt) => ({ ok: true, saved: savedAttempt(attempt) }));
  mocks.check.mockResolvedValue({ ok: false, message: "男女両方の保存を確認できませんでした" });
});

it("opening legacy male/female first heats preserves separate positions and confirmation without writing", async () => {
  const draft = render();
  expect(draft).toMatchObject({ dirty: false, blocked: [], reviewing: false });
  expect(draft.data.participants.map(person => [person.entryId, person.group, person.order])).toEqual([[`${male}:${a}`, 1, 1], [`${female}:${b}`, 100, 1]]);
  expect(initial.map(value => value.data.confirmed)).toEqual([true, true]);
  await draft.save();
  expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.check).not.toHaveBeenCalled();
});

it("new entrants including the first opposite division appear unplaced without making a save request", async () => {
  const source = [initial[0]];
  render(source, [entries[0]]);
  const roster = [...entries, entry("new")];
  const draft = render(source, roster);
  expect(draft.dirty).toBe(false);
  expect(draft.data.participants.filter(person => person.entryId !== `${male}:${a}`).map(person => [person.group, person.order, person.trials])).toEqual([[null, null, []], [null, null, []]]);
  await draft.save();
  expect(mocks.write).not.toHaveBeenCalled();
});

it("saves both source events in one request with original entry IDs, trials, revisions and raw base snapshots", async () => {
  render().change(mixed());
  await render().save();
  const attempt = mocks.write.mock.calls[0][0] as Attempt;
  expect(attempt).toEqual({ family: "100m", operations: [
    { event: male, revision: 3, baseData: initial[0].data, data: { confirmed: false, participants: [{ ...placed(a), heatScope: "混合", order: 1 }] } },
    { event: female, revision: 5, baseData: initial[1].data, data: { confirmed: false, participants: [{ ...placed(b), heatScope: "混合", order: 2 }] } },
  ] });
  expect(mocks.write).toHaveBeenCalledTimes(1); expect(mocks.check).not.toHaveBeenCalled();
  expect(mocks.onSaved).toHaveBeenCalledWith(savedAttempt(attempt));
  expect(render()).toMatchObject({ dirty: false, locked: false, failed: false, message: "保存しました" });
});

it("a new blank entrant clears that source's confirmation when an actual sibling edit is saved", async () => {
  const roster = [...entries, entry("new")];
  let draft = render(initial, roster);
  draft.change({ ...draft.data, participants: draft.data.participants.map(person => person.entryId === `${female}:${b}` ? { ...person, order: 2 } : person) });
  draft = render(initial, roster);
  await draft.save();
  const attempt = mocks.write.mock.calls[0][0] as Attempt;
  expect(attempt.operations[0].data).toEqual({ confirmed: false, participants: [placed(a), emptyPerformance("new")] });
  expect(attempt.operations[0].baseData).toEqual(initial[0].data);
});

it("undoing all positions returns to clean and a per-person undo preserves the other source's edits", async () => {
  render().change(mixed());
  render().discardPerson(`${male}:${a}`);
  expect(render().data.participants.map(person => person.group)).toEqual([1, 199]);
  expect(render().dirty).toBe(true);
  render().discardPerson(`${female}:${b}`);
  expect(render().dirty).toBe(false);
  await render().save();
  expect(mocks.write).not.toHaveBeenCalled();
});

it("confirmation toggles and empty input scaffolding cannot cause a family form write", async () => {
  const data = render().data;
  render().change({ ...data, confirmed: false, participants: data.participants.map(person => ({ ...person, trials: [...person.trials, { mark: "", status: "pending", wind: "" }] })) });
  expect(render().dirty).toBe(false);
  await render().save();
  expect(mocks.write).not.toHaveBeenCalled();
});

it("freezes an uncertain attempt, ignores edits/refresh/roster additions, and only reads again without resending", async () => {
  mocks.write.mockResolvedValueOnce({ ok: false, uncertain: true });
  const edited = mixed(); render().change(edited);
  await render().save();
  const frozen = structuredClone(mocks.write.mock.calls[0][0]);
  expect(render()).toMatchObject({ unconfirmed: true, locked: true, busy: false, failed: true, dirty: true });
  render().change({ ...edited, participants: edited.participants.map(person => ({ ...person, group: 200 })) });
  render().discardPerson(`${male}:${a}`);
  const remote = [operation(male, { ...placed(a), order: 8 }, 8), initial[1]];
  const draft = render(remote, [...entries, entry("new")]);
  expect(draft.data).toEqual(edited);
  await draft.save();
  expect(mocks.write).toHaveBeenCalledTimes(1); expect(mocks.check).toHaveBeenCalledTimes(2);
  expect(mocks.check.mock.calls.map(call => call[0])).toEqual([frozen, frozen]);
  expect(mocks.refresh).not.toHaveBeenCalled(); expect(mocks.onSaved).not.toHaveBeenCalled();
});

it("response loss and read failure retain the immutable request until both saved sources are confirmed", async () => {
  mocks.write.mockRejectedValueOnce(new Error("response lost"));
  mocks.check.mockRejectedValueOnce(new Error("read unavailable"));
  render().change(mixed());
  await render().save();
  const attempt = mocks.write.mock.calls[0][0] as Attempt;
  const confirmed = savedAttempt(attempt);
  confirmed[1] = { ...confirmed[1], revision: 8, data: { ...confirmed[1].data, participants: [{ ...confirmed[1].data.participants[0], trials: [{ mark: "13.45", status: "valid", wind: "" }] }, emptyPerformance("new")] } };
  expect(render()).toMatchObject({ unconfirmed: true, locked: true, failed: true });
  mocks.check.mockResolvedValueOnce({ ok: true, saved: confirmed });
  await render().save();
  expect(render()).toMatchObject({ unconfirmed: false, locked: false, dirty: false, failed: false, message: "保存しました" });
  expect(render().data.participants.map(person => person.entryId)).toEqual([`${male}:${a}`, `${female}:${b}`, `${female}:new`]);
  expect(render().data.participants[1].trials[0].mark).toBe("13.45");
  expect(mocks.onSaved).toHaveBeenCalledWith(confirmed); expect(mocks.write).toHaveBeenCalledTimes(1);
});

it("a partial-save read is not success and retains both local changes for another read", async () => {
  mocks.write.mockResolvedValueOnce({ ok: false, uncertain: true });
  mocks.check.mockResolvedValue({ ok: false, message: "男女両方の保存を確認できませんでした" });
  const edited = mixed(); render().change(edited);
  await render().save(); await render().save();
  expect(render().data).toEqual(edited);
  expect(render()).toMatchObject({ unconfirmed: true, locked: true, failed: true });
  expect(mocks.write).toHaveBeenCalledTimes(1); expect(mocks.onSaved).not.toHaveBeenCalled();
});

it("a definitive rollback unlocks input and an explicit corrected retry sends a fresh attempt", async () => {
  mocks.write.mockResolvedValueOnce({ ok: false, message: "配置を確認してください" });
  render().change(mixed()); await render().save();
  expect(render()).toMatchObject({ unconfirmed: false, locked: false, failed: true, dirty: true });
  const correction = render().data;
  render().change({ ...correction, participants: correction.participants.map(person => ({ ...person, group: 200 })) });
  await render().save();
  expect(mocks.write).toHaveBeenCalledTimes(2); expect(mocks.check).not.toHaveBeenCalled();
  expect((mocks.write.mock.calls[1][0] as Attempt).operations.every(request => request.data.participants[0].group === 2)).toBe(true);
  expect(mocks.refresh).toHaveBeenCalledTimes(1); expect(render().dirty).toBe(false);
});

it("requires a conflict choice then rebases both revisions while retaining the chosen position and current records", async () => {
  const latest = [operation(male, { ...placed(a), order: 2, trials: [{ mark: "12.99", status: "valid", wind: "" }] }, 4), initial[1]];
  mocks.write.mockResolvedValueOnce({ ok: false, latest, message: "変更箇所を確認してください" });
  render().change(mixed()); await render().save();
  let draft = render();
  expect(draft).toMatchObject({ reviewing: true, unconfirmed: false, locked: false });
  expect(draft.review?.conflicts.map(conflict => conflict.key)).toEqual([`${male}:${a}:position`]);
  expect(draft.conflictEntries.map(value => value.id)).toEqual([`${male}:${a}`, `${female}:${b}`]);
  draft.applyReview(); await render().save();
  expect(mocks.write).toHaveBeenCalledTimes(1);
  render().setChoices({ [`${male}:${a}:position`]: "own" }); render().applyReview();
  draft = render();
  expect(draft).toMatchObject({ reviewing: false, dirty: true });
  expect(draft.data.participants[0]).toMatchObject({ group: 199, order: 1, trials: [{ mark: "12.99" }] });
  await draft.save();
  expect((mocks.write.mock.calls[1][0] as Attempt).operations.map(request => request.revision)).toEqual([4, 5]);
  expect(mocks.check).not.toHaveBeenCalled();
});

it("refresh takes each source's maximum revision without replacing a newer unchanged sibling", () => {
  render();
  const incoming = [operation(male, { ...placed(a), order: 2 }, 4), operation(female, { ...placed(b), order: 9 }, 4), operation(male, { ...placed(a), order: 7 }, 2)];
  render(incoming);
  const draft = render(incoming);
  expect(draft.data.participants.map(person => person.order)).toEqual([2, 1]);
  expect(draft.revision).toBe(`${female}:5|${male}:4`);
  expect(draft.dirty).toBe(false); expect(mocks.write).not.toHaveBeenCalled();
});

it("a nonoverlapping remote refresh preserves local sibling placement and merges current records", () => {
  const data = render().data;
  render().change({ ...data, participants: data.participants.map(person => person.entryId === `${female}:${b}` ? { ...person, order: 2 } : person) });
  const incoming = [operation(male, { ...placed(a), trials: [{ mark: "12.99", status: "valid", wind: "" }] }, 4), initial[1]];
  render(incoming);
  const draft = render(incoming);
  expect(draft).toMatchObject({ reviewing: false, dirty: true });
  expect(draft.data.participants.map(person => [person.order, person.trials[0].mark])).toEqual([[1, "12.99"], [2, "12.34"]]);
  expect(draft.revision).toContain(`${male}:4`);
});

it("blocks pending participant edits when absence or registration withdrawal arrives, without erasing trials", async () => {
  render().change(mixed());
  const roster = [{ ...entries[0], absent: true }, { ...entries[1], events: [] }];
  const draft = render(initial, roster);
  expect(draft.blocked.map(person => person.entryId)).toEqual([`${male}:${a}`, `${female}:${b}`]);
  await draft.save();
  expect(render(initial, roster)).toMatchObject({ failed: true, locked: false, dirty: true });
  expect(render(initial, roster).data.participants.every(person => person.trials[0].mark === "12.34")).toBe(true);
  expect(mocks.write).not.toHaveBeenCalled();
  draft.discardPerson(`${male}:${a}`); render(initial, roster).discardPerson(`${female}:${b}`);
  expect(render(initial, roster)).toMatchObject({ blocked: [], dirty: false });
});

it("unchanged absent or withdrawn saved results do not prevent an eligible sibling's edit", async () => {
  const roster = [{ ...entries[0], absent: true, events: [] }, entries[1]];
  const data = render(initial, roster).data;
  render(initial, roster).change({ ...data, participants: data.participants.map(person => person.entryId === `${female}:${b}` ? { ...person, order: 2 } : person) });
  expect(render(initial, roster).blocked).toEqual([]);
  await render(initial, roster).save();
  expect(mocks.write).toHaveBeenCalledTimes(1);
  expect((mocks.write.mock.calls[0][0] as Attempt).operations[0].data).toEqual(initial[0].data);
});

it("prevents duplicate writes and edits while the atomic request is in flight", async () => {
  let respond!: (result: unknown) => void;
  mocks.write.mockReturnValueOnce(new Promise(resolve => { respond = resolve; }));
  const edited = mixed(); render().change(edited);
  const pending = render().save();
  expect(render()).toMatchObject({ busy: true, locked: true });
  render().change({ ...edited, participants: [] }); render().discardPerson(`${male}:${a}`);
  await render().save();
  expect(render().data).toEqual(edited); expect(mocks.write).toHaveBeenCalledTimes(1);
  respond({ ok: true, saved: savedAttempt(mocks.write.mock.calls[0][0]) }); await pending;
  expect(render()).toMatchObject({ busy: false, locked: false, dirty: false });
});

it("validates shared positions before sending while accepting field order 600", async () => {
  const invalid = mixed(); render().change({ ...invalid, participants: invalid.participants.map(person => ({ ...person, order: 1 })) });
  await render().save();
  expect(render().message).toContain("重複"); expect(mocks.write).not.toHaveBeenCalled();
  hooks.values = [];
  const family = "砲丸投げ", event = `男子${family}`;
  const source = [operation(event, { ...placed(a), trials: [{ mark: "8.50", status: "valid", wind: "" }] })];
  const roster = [entry(a, event)];
  const draft = render(source, roster, family);
  draft.change({ ...draft.data, participants: draft.data.participants.map(person => ({ ...person, order: 600 })) });
  await render(source, roster, family).save();
  expect((mocks.write.mock.calls[0][0] as Attempt).operations[0].data.participants[0].order).toBe(600);
  expect(render(source, roster, family)).toMatchObject({ failed: false, dirty: false });
});
