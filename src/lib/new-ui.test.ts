import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NEW_UI_CHANGE,
  newUiStorageKey,
  readNewUiPreference,
  subscribeNewUiPreference,
  writeNewUiPreference,
} from "./new-ui";

let values: Map<string, string>;
let storage: { getItem: ReturnType<typeof vi.fn>; setItem: ReturnType<typeof vi.fn> };
let browser: EventTarget;
const subscriptions: Array<() => void> = [];

beforeEach(() => {
  values = new Map();
  storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
  browser = Object.assign(new EventTarget(), { localStorage: storage });
  vi.stubGlobal("window", browser);
});

afterEach(() => {
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
  vi.unstubAllGlobals();
});

describe("per-account browser preference", () => {
  it("starts off and does not inherit another account's opt-in", () => {
    expect(readNewUiPreference("alice")).toBe(false);
    expect(writeNewUiPreference("alice", true)).toBe(true);
    expect(readNewUiPreference("alice")).toBe(true);
    expect(readNewUiPreference("bob")).toBe(false);
    expect(writeNewUiPreference("bob", true)).toBe(true);
    expect(writeNewUiPreference("alice", false)).toBe(true);
    expect(readNewUiPreference("alice")).toBe(false);
    expect(readNewUiPreference("bob")).toBe(true);
  });

  it("accepts only the explicit saved opt-in", () => {
    for (const value of ["", "off", "true", "1", "ON", " on ", "invalid"]) {
      values.set(newUiStorageKey("alice"), value);
      expect(readNewUiPreference("alice")).toBe(false);
    }
    values.set(newUiStorageKey("alice"), "on");
    expect(readNewUiPreference("alice")).toBe(true);
  });

  it("returns the safe default when storage access itself is blocked", () => {
    Object.defineProperty(browser, "localStorage", {
      get() { throw new Error("Storage access denied"); },
    });
    expect(readNewUiPreference("alice")).toBe(false);
    expect(writeNewUiPreference("alice", true)).toBe(false);
  });

  it("returns the safe default when reading storage fails", () => {
    storage.getItem.mockImplementation(() => { throw new Error("Read failed"); });
    expect(readNewUiPreference("alice")).toBe(false);
  });

  it("reports a failed write without changing the saved state or notifying subscribers", () => {
    values.set(newUiStorageKey("alice"), "on");
    const changed = vi.fn();
    subscriptions.push(subscribeNewUiPreference(changed));
    storage.setItem.mockImplementation(() => { throw new Error("Quota exceeded"); });
    expect(writeNewUiPreference("alice", false)).toBe(false);
    expect(readNewUiPreference("alice")).toBe(true);
    expect(changed).not.toHaveBeenCalled();
  });

  it("is safe to read or attempt to write without a browser", () => {
    vi.stubGlobal("window", undefined);
    expect(readNewUiPreference("alice")).toBe(false);
    expect(writeNewUiPreference("alice", true)).toBe(false);
  });
});

describe("preference change subscriptions", () => {
  it("notifies same-document consumers after the new value has been persisted", () => {
    const states: boolean[] = [];
    subscriptions.push(subscribeNewUiPreference(() => states.push(readNewUiPreference("alice"))));
    writeNewUiPreference("alice", true);
    writeNewUiPreference("alice", false);
    expect(states).toEqual([true, false]);
  });

  it("rereads the account preference after a cross-tab storage event", () => {
    const states: boolean[] = [];
    subscriptions.push(subscribeNewUiPreference(() => states.push(readNewUiPreference("alice"))));
    values.set(newUiStorageKey("alice"), "on");
    browser.dispatchEvent(new Event("storage"));
    values.delete(newUiStorageKey("alice"));
    browser.dispatchEvent(new Event("storage"));
    expect(states).toEqual([true, false]);
  });

  it("removes both event listeners without disconnecting other consumers", () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribe = subscribeNewUiPreference(first);
    subscriptions.push(unsubscribe, subscribeNewUiPreference(second));
    unsubscribe();
    browser.dispatchEvent(new Event(NEW_UI_CHANGE));
    browser.dispatchEvent(new Event("storage"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(2);
  });
});
