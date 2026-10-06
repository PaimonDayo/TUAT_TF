import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { ObEntry } from "@/lib/ob-entries";
import type { ObDuty, ObDutyRole } from "@/lib/ob-duty";

const mocks = vi.hoisted(() => ({ write: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/app/(app)/ob-entries/actions", () => ({ claimMyEntry: mocks.write, deleteDutyRole: mocks.write, saveDutyRole: mocks.write, saveDutyPeople: mocks.write }));
vi.mock("./ObEntryEditor", () => ({ ObEntryEditor: () => null }));
vi.mock("./ObDutyReviewProvider", () => ({ useObDutyReview: () => ({ unread: [] }) }));
vi.mock("./ObDutyIssues", () => ({ ObDutyIssues: () => null }));
vi.mock("@/components/ui/form-modal", () => ({ FormModal: ({ children }: { children: ReactNode }) => createElement("div", {}, children), FormModalFooter: ({ children }: { children: ReactNode }) => createElement("footer", {}, children) }));
import { ObMyEntry } from "./ObMyEntry";
import { ObDutyRoleManager } from "./ObDutyRoleManager";

const entry: ObEntry = { id: "entry", profile_id: "profile", meet_key: "ob-2026", submitted_name: "大会の修正名", grade: "M2", events: [], qualification_marks: {}, revision: 4, imported_at: "2026-09-24T00:00:00Z" };
const me = { id: "profile", display_name: "プロフィールの旧名", grade: "1" };

it("uses corrected registration details in the own-entry heading and leaves the profile unchanged", () => {
  const before = structuredClone({ entry, me });
  const html = renderToStaticMarkup(createElement(ObMyEntry, { entry, me }));
  expect(html).toContain("M2 大会の修正名"); expect(html).not.toContain("プロフィールの旧名");
  expect({ entry, me }).toEqual(before); expect(mocks.write).not.toHaveBeenCalled();
});

it("keeps the profile name/grade heading when no registration exists", () => {
  const html = renderToStaticMarkup(createElement(ObMyEntry, { entry: null, me }));
  expect(html).toContain("B1 プロフィールの旧名"); expect(html).toContain("まだエントリーしていません");
  expect(mocks.write).not.toHaveBeenCalled();
});

it("shows corrected details in assigned helper lists and retains profile-only assignments", () => {
  const other = { id: "other", display_name: "登録未確認の担当者", grade: "3" };
  const role: ObDutyRole = { id: "role", meet_key: "ob-2026", slot_time: "11:00", event_name: "砲丸投げ", name: "計測", abbreviation: "測", required_count: 2, revision: 1 };
  const duties: ObDuty[] = [me.id, other.id].map(profile_id => ({ meet_key: "ob-2026", profile_id, slot_time: role.slot_time, event_name: role.event_name, role_ids: [role.id], assignment: "計測", revision: 2 }));
  const html = renderToStaticMarkup(createElement(ObDutyRoleManager, { entries: [entry], members: [me, other], duties, roles: [role], time: role.slot_time, event: role.event_name, onClose: vi.fn() }));
  expect(html).toContain("M2</span>大会の修正名"); expect(html).not.toContain("プロフィールの旧名");
  expect(html).toContain("B3</span>登録未確認の担当者"); expect(mocks.write).not.toHaveBeenCalled();
});
