"use client";

import {
  useCallback,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  BOOLEAN_PREFERENCE_EVENT,
  isBooleanPreferenceEvent,
  readBooleanPreference,
  writeBooleanPreference,
} from "@/lib/boolean-preference";

export function useBooleanPreference(initial: boolean, key?: string) {
  const [localValue, setLocalValue] = useState(initial);

  const subscribe = useCallback((onStoreChange: () => void) => {
    if (!key) return () => {};
    const preferenceKey = key;

    function handlePreferenceChange(event: Event) {
      if (isBooleanPreferenceEvent(event, preferenceKey)) onStoreChange();
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === preferenceKey) onStoreChange();
    }

    window.addEventListener(BOOLEAN_PREFERENCE_EVENT, handlePreferenceChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(BOOLEAN_PREFERENCE_EVENT, handlePreferenceChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, [key]);

  const getSnapshot = useCallback(
    () => (key ? (readBooleanPreference(key) ?? initial) : initial),
    [initial, key],
  );
  const getServerSnapshot = useCallback(() => initial, [initial]);
  const storedValue = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const setValue: Dispatch<SetStateAction<boolean>> = useCallback(
    (next) => {
      if (!key) {
        setLocalValue(next);
        return;
      }
      const current = readBooleanPreference(key) ?? storedValue;
      const value = typeof next === "function" ? next(current) : next;
      writeBooleanPreference(key, value);
    },
    [key, storedValue],
  );

  return [key ? storedValue : localValue, setValue] as const;
}
