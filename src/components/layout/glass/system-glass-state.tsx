"use client";

import { useEffect } from "react";
import { attachGlassPress } from "./glass-press";

// All app and portal controls use the same layout from their first render.
// The marker only owns the shared press listener; it does not gate visuals.
let owners = 0;
let stopPress: (() => void) | undefined;
export function useSystemGlass() {
  return true;
}
export function SystemGlassMarker() {
  useEffect(() => {
    owners++;
    if (owners === 1) stopPress = attachGlassPress();
    return () => {
      owners--;
      if (owners === 0) { stopPress?.(); stopPress = undefined; }
    };
  }, []);
  // The public bottom tab's layout-preserving capture predates the new UI.
  // Switching visual versions must not reintroduce its top-of-page misalignment.
  return <span hidden data-new-ui data-system-glass-preview data-liquid-glass-ignore />;
}
