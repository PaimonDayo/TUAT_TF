"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import type { ObDutyIssue } from "@/lib/ob-duty-issues";

const UserContext = createContext("");
const changed = "ob-duty-review-changed";
const memory = new Map<string, string>();
const storageKey = (id: string) => `tuat:ob-duty-reviewed:ob-2026:${id}`;
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(changed, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(changed, listener); };
}
function read(key: string) {
  try { return window.localStorage.getItem(key) ?? memory.get(key) ?? "[]"; }
  catch { return memory.get(key) ?? "[]"; }
}
export function ObDutyReviewProvider({ userId, children }: { userId: string; children: ReactNode }) {
  return <UserContext.Provider value={userId}>{children}</UserContext.Provider>;
}
export function useObDutyReview(issues: ObDutyIssue[]) {
  const userId = useContext(UserContext), key = storageKey(userId);
  const raw = useSyncExternalStore(subscribe, () => userId ? read(key) : "[]", () => "[]");
  let values: string[] = [];
  try { const parsed: unknown = JSON.parse(raw); if (Array.isArray(parsed)) values = parsed.filter((value): value is string => typeof value === "string"); } catch { /* Ignore damaged preferences. */ }
  const reviewed = new Set(values);
  const signature = (issue: ObDutyIssue) => issue.fingerprint ?? JSON.stringify([issue.key, issue.text]);
  function mark(group: ObDutyIssue[], seen: boolean) {
    if (!userId) return;
    // Read at click time so other mounted views/tabs cannot overwrite a newer review.
    let current: string[] = [];
    try { const parsed: unknown = JSON.parse(read(key)); if (Array.isArray(parsed)) current = parsed.filter((value): value is string => typeof value === "string"); } catch { /* Reset damaged preferences. */ }
    const next = new Set(current);
    for (const issue of group) { if (seen) next.add(signature(issue)); else next.delete(signature(issue)); }
    const saved = JSON.stringify([...next].slice(-1000));
    memory.set(key, saved);
    try { window.localStorage.setItem(key, saved); } catch { /* Keep the current session usable if storage is unavailable. */ }
    window.dispatchEvent(new Event(changed));
  }
  return { unread: issues.filter(issue => !reviewed.has(signature(issue))), isReviewed: (issue: ObDutyIssue) => reviewed.has(signature(issue)), mark, canReview: !!userId };
}
