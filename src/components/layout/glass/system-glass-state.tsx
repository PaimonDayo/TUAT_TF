"use client";

import { useEffect, useSyncExternalStore } from "react";
import { attachGlassPress } from "./glass-press";

// The server mounts this marker only for the effective manageSystem role.
// No extra profile request or document-wide mutation observer is needed.
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
export function SystemGlassMarker() {
  useEffect(() => {
    owners++;
    if (owners === 1) stopPress = attachGlassPress();
    listeners.forEach((listener) => listener());
    return () => {
      owners--;
      if (owners === 0) { stopPress?.(); stopPress = undefined; }
      listeners.forEach((listener) => listener());
    };
  }, []);
  return <span hidden data-system-glass-preview data-liquid-glass-ignore />;
}
