export const NEW_UI_CHANGE = "tuat:new-ui-change";
export const newUiStorageKey = (userId: string) => `track-app:new-ui:v1:${userId}`;

/** This browser and this account only; storage is a preference, never authority. */
export function readNewUiPreference(userId: string): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(newUiStorageKey(userId)) === "on"; }
  catch { return false; }
}

export function writeNewUiPreference(userId: string, enabled: boolean): boolean {
  try {
    window.localStorage.setItem(newUiStorageKey(userId), enabled ? "on" : "off");
    window.dispatchEvent(new Event(NEW_UI_CHANGE));
    return true;
  } catch { return false; }
}

export function subscribeNewUiPreference(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(NEW_UI_CHANGE, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(NEW_UI_CHANGE, callback);
  };
}

