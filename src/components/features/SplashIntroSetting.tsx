"use client";

import { useSyncExternalStore } from "react";
import { Toggle } from "@/components/ui/toggle";

const STORAGE_KEY = "tuat-splash-disabled";
const CHANGE_EVENT = "tuat-splash-setting-change";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGE_EVENT, callback);
  };
}

function getSnapshot() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function SplashIntroSetting() {
  const skip = useSyncExternalStore(subscribe, getSnapshot, () => false);

  function toggle() {
    const next = !skip;
    try {
      if (next) {
        localStorage.setItem(STORAGE_KEY, "1");
        document.documentElement.dataset.tuatSplashSkip = "1";
      } else {
        localStorage.removeItem(STORAGE_KEY);
        delete document.documentElement.dataset.tuatSplashSkip;
      }
    } catch {
      // The setting remains usable for the current render.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return <Toggle label={"\u8d77\u52d5\u753b\u9762\u3092\u30b9\u30ad\u30c3\u30d7"} description={"\u6b21\u56de\u4ee5\u964d\u3001\u8d77\u52d5\u753b\u9762\u3092\u8868\u793a\u3057\u307e\u305b\u3093"} checked={skip} onChange={toggle} />;
}
