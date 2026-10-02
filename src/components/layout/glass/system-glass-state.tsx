"use client";

import { useEffect, useSyncExternalStore } from "react";
import { attachGlassPress } from "./glass-press";
import { readNewUiPreference, subscribeNewUiPreference } from "@/lib/new-ui";

// The authenticated app mounts this bridge for every member. Visuals still
// require this account's opt-in. The store reaches existing sibling and portal
// controls without delaying the streamed page on another profile request.
let owners = 0;
let stopPress: (() => void) | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export function useSystemGlass() {
  return useSyncExternalStore(subscribe, () => owners > 0, () => false);
}
export function SystemGlassMarker({ userId, preserveCaptureLayout }: { userId: string; preserveCaptureLayout: boolean }) {
  const enabled = useSyncExternalStore(subscribeNewUiPreference, () => readNewUiPreference(userId), () => false);
  useEffect(() => {
    if (!enabled) return;
    owners++;
    if (owners === 1) stopPress = attachGlassPress();
    listeners.forEach((listener) => listener());
    return () => {
      owners--;
      if (owners === 0) { stopPress?.(); stopPress = undefined; }
      listeners.forEach((listener) => listener());
    };
  }, [enabled]);
  // The public bottom tab's layout-preserving capture predates the new UI.
  // Switching visual versions must not reintroduce its top-of-page misalignment.
  return <span hidden data-new-ui={enabled || undefined} data-system-glass-preview={preserveCaptureLayout || enabled || undefined} data-liquid-glass-ignore />;
}
