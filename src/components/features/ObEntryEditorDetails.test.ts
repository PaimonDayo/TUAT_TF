import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { ObEntry } from "@/lib/ob-entries";

type InputProps = { value: string; disabled?: boolean; onChange: (e: { target: { value: string } }) => void; "aria-label": string };
type SelectProps = { value: string; disabled?: boolean; onValueChange: (value: string) => void; ariaLabel: string; options: { value: string; disabled?: boolean }[] };
type ButtonProps = { children: ReactNode; disabled?: boolean; onClick?: () => void };
const hooks = vi.hoisted(() => ({ cursor: 0, values: [] as unknown[] }));
const mocks = vi.hoisted(() => ({ save: vi.fn(), check: vi.fn(), guest: vi.fn(), close: vi.fn(), refresh: vi.fn(), toast: vi.fn(), conflicts: vi.fn(), inputs: new Map<string, InputProps>(), selects: new Map<string, SelectProps>(), buttons: new Map<string, ButtonProps>(), modal: {} as { onOpenChange: (open: boolean) => void }, confirm: {} as { open: boolean; onConfirm: () => void } }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), useState<T>(initial: T | (() => T)) {
  const slot = hooks.cursor++; if (!(slot in hooks.values)) hooks.values[slot] = typeof initial === "function" ? (initial as () => T)() : initial;
  return [hooks.values[slot], (value: T | ((before: T) => T)) => { hooks.values[slot] = typeof value === "function" ? (value as (before: T) => T)(hooks.values[slot] as T) : value; }];
}, useRef<T>(initial: T) { const slot = hooks.cursor++; if (!(slot in hooks.values)) hooks.values[slot] = { current: initial }; return hooks.values[slot]; } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/(app)/ob-entries/actions", () => ({ saveEntry: mocks.save, checkEntryDetails: mocks.check, createGuestEntry: mocks.guest }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock("@/lib/ob-duty-issues", () => ({ entryDutyConflicts: mocks.conflicts }));
vi.mock("@/components/ui/form-modal", () => ({ FormModal: (props: { children: ReactNode; onOpenChange: (open: boolean) => void }) => { mocks.modal = props; return createElement("div", {}, props.children); }, FormModalFooter: ({ children }: { children: ReactNode }) => createElement("footer", {}, children) }));
vi.mock("@/components/ui/input", () => ({ Input: (props: InputProps) => { mocks.inputs.set(props["aria-label"], props); return createElement("input", { value: props.value, disabled: props.disabled }); } }));
vi.mock("@/components/ui/select", () => ({ Select: (props: SelectProps) => { mocks.selects.set(props.ariaLabel, props); return createElement("select", { disabled: props.disabled }); } }));
vi.mock("@/components/ui/button", () => ({ Button: (props: ButtonProps) => { if (typeof props.children === "string") mocks.buttons.set(props.children, props); return createElement("button", { disabled: props.disabled }, props.children); } }));
vi.mock("@/components/ui/confirm-dialog", () => ({ ConfirmDialog: (props: typeof mocks.confirm) => { mocks.confirm = props; return null; } }));
vi.mock("@/components/ui/disclosure", () => ({ Disclosure: () => null }));
import { ObEntryEditor } from "./ObEntryEditor";
const entry: ObEntry = { id: "20000000-0000-4000-8000-000000000001", meet_key: "ob-2026", submitted_name: "合成取込", grade: "B1", profile_id: null, revision: 2, imported_at: "2026-10-01", competition_division: "男子", events: ["男子100m"], qualification_marks: { "男子100m": "11.50" } };
function render(props: Partial<Parameters<typeof ObEntryEditor>[0]> = {}) { hooks.cursor = 0; mocks.inputs.clear(); mocks.selects.clear(); mocks.buttons.clear(); return renderToStaticMarkup(createElement(ObEntryEditor, { entry, members: [], onClose: mocks.close, ...props })); }
const name = (value: string) => mocks.inputs.get("参加者の氏名")!.onChange({ target: { value } });
const grade = (value: string) => mocks.selects.get("参加者の学年・所属")!.onValueChange(value);
async function click(label: string) { mocks.buttons.get(label)!.onClick!(); for (let i = 0; i < 8; i++) await Promise.resolve(); }
beforeEach(() => { hooks.values = []; vi.clearAllMocks(); mocks.conflicts.mockReturnValue([]); mocks.save.mockResolvedValue({ ok: true }); mocks.check.mockResolvedValue({ ok: true }); });

it("opens imported names and grades without writing or becoming dirty, and returning to the original values stays clean", () => {
  render(); expect(mocks.inputs.get("参加者の氏名")!.value).toBe(entry.submitted_name); expect(mocks.selects.get("参加者の学年・所属")!.value).toBe("B1"); expect(mocks.buttons.get("変更を保存する")!.disabled).toBe(true);
  name("合成修正"); grade("M2"); render(); expect(mocks.buttons.get("変更を保存する")!.disabled).toBe(false);
  name(entry.submitted_name); grade("B1"); render(); expect(mocks.buttons.get("変更を保存する")!.disabled).toBe(true); mocks.modal.onOpenChange(false); expect(mocks.close).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
});
it("saves only metadata on the same participant without a new duty-conflict prompt", async () => {
  mocks.conflicts.mockReturnValue([{ slot_time: "10:00", event_name: "100m", assignment: "計時" }]); render(); name("修正後"); grade("OB・OG"); render();
  expect(mocks.conflicts).not.toHaveBeenCalled(); expect(mocks.confirm.open).toBe(false); await click("変更を保存する");
  expect(mocks.save).toHaveBeenCalledWith({ entryId: entry.id, profileId: null, revision: 2, events: entry.events, marks: entry.qualification_marks, details: { name: "修正後", grade: "OB・OG" } }, { id: null, revision: null, status: "未回答" }, false); expect(mocks.refresh).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce();
});
it("preserves a legacy grade as a disabled existing option until it is corrected", () => { render({ entry: { ...entry, grade: "学部1年" } }); expect(mocks.selects.get("参加者の学年・所属")!.value).toBe("学部1年"); expect(mocks.selects.get("参加者の学年・所属")!.options).toContainEqual({ value: "学部1年", label: "学部1年", disabled: true }); expect(mocks.buttons.get("変更を保存する")!.disabled).toBe(true); });
it("keeps a definitive failure editable with the name and grade still entered", async () => { mocks.save.mockResolvedValue({ ok: false, uncertain: false, message: "合成失敗" }); render(); name("修正後"); grade("M1"); render(); await click("変更を保存する"); render(); expect(mocks.inputs.get("参加者の氏名")).toMatchObject({ value: "修正後", disabled: false }); expect(mocks.selects.get("参加者の学年・所属")).toMatchObject({ value: "M1", disabled: false }); expect(mocks.buttons.get("変更を保存する")!.disabled).toBe(false); expect(mocks.close).not.toHaveBeenCalled(); });
it.each(["throw", "uncertain"])("locks an unknown %s save and only reads the frozen request until confirmed", async type => {
  if (type === "throw") mocks.save.mockRejectedValue(new Error("transport")); else mocks.save.mockResolvedValue({ ok: false, uncertain: true });
  mocks.check.mockResolvedValue({ ok: false, message: "合成読取失敗" }); render(); name("修正後"); grade("M1"); render(); await click("変更を保存する"); const [input, party] = mocks.save.mock.calls[0]; render();
  expect(mocks.inputs.get("参加者の氏名")!.disabled).toBe(true); expect(mocks.selects.get("参加者の学年・所属")!.disabled).toBe(true); expect(mocks.selects.get("懇親会の出欠")!.disabled).toBe(true); mocks.modal.onOpenChange(false); expect(mocks.close).not.toHaveBeenCalled();
  await click("保存結果を確認"); render(); expect(mocks.check).toHaveBeenCalledWith(input, party); expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.inputs.get("参加者の氏名")!.disabled).toBe(true);
  mocks.check.mockResolvedValue({ ok: true }); await click("保存結果を確認"); expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.check).toHaveBeenCalledTimes(2); expect(mocks.close).toHaveBeenCalledOnce();
});
it("keeps metadata controls out of self editing and does not attach details to ordinary changes", async () => { render({ self: true }); expect(mocks.inputs.has("参加者の氏名")).toBe(false); expect(mocks.selects.has("参加者の学年・所属")).toBe(false); mocks.selects.get("懇親会の出欠")!.onValueChange("参加"); render({ self: true }); await click("変更を保存する"); expect(mocks.save.mock.calls[0][0]).not.toHaveProperty("details"); });
it("freezes a linked party revision and its edited status alongside metadata during an unknown save", async () => {
  const party = { id: "20000000-0000-4000-8000-000000000011", meet_key: "ob-2026", submitted_name: entry.submitted_name, group_label: "B1", status: "参加" as const, entry_id: entry.id, revision: 8, needs_review: false };
  mocks.save.mockResolvedValue({ ok: false, uncertain: true }); mocks.check.mockResolvedValue({ ok: false }); render({ party }); name("修正後"); mocks.selects.get("懇親会の出欠")!.onValueChange("不参加"); render({ party }); await click("変更を保存する"); render({ party });
  await click("保存結果を確認"); expect(mocks.check).toHaveBeenCalledWith(expect.objectContaining({ details: { name: "修正後", grade: "B1" } }), { id: party.id, revision: 8, status: "不参加" }); expect(mocks.save).toHaveBeenCalledOnce(); expect(mocks.close).not.toHaveBeenCalled();
});
