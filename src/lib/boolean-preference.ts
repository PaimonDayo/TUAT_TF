"use client";

export const BOOLEAN_PREFERENCE_EVENT = "tf:boolean-preference-change";

type BooleanPreferenceDetail = {
  key: string;
  value: boolean;
};

export function readBooleanPreference(key: string): boolean | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Safariのプライベートモードなどでstorageを使えない場合は、SSRのCookie値を使う。
  }
  return null;
}

export function writeBooleanPreference(key: string, value: boolean) {
  document.cookie = [
    `${key}=${value ? "1" : "0"}`,
    "path=/",
    "max-age=31536000",
    "samesite=lax",
  ].join(";");

  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Cookieへの保存は完了しているため、そのまま続行する。
  }

  window.dispatchEvent(
    new CustomEvent<BooleanPreferenceDetail>(BOOLEAN_PREFERENCE_EVENT, {
      detail: { key, value },
    }),
  );
}

export function isBooleanPreferenceEvent(
  event: Event,
  key: string,
): event is CustomEvent<BooleanPreferenceDetail> {
  return (
    event instanceof CustomEvent &&
    event.detail?.key === key &&
    typeof event.detail.value === "boolean"
  );
}
