import { describe, expect, it } from "vitest";
import {
  applicationServerKeyMatches,
  decideReconcileAction,
  urlBase64ToUint8Array,
} from "./push";

// 実際のVAPID公開鍵と同じ形（base64url・65バイト）のダミー鍵。
const KEY_A =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const KEY_B =
  "BNbxGYNyhs6HdchGrKQdlNBiFPWCbYVCnGmzZ8QQ0fUZ0FUMSjWWLpcaFbLxCTBQd0EFPfqLLnAkT4Q4hHtGBcU";

function keyBytes(base64url: string): ArrayBuffer {
  const bytes = urlBase64ToUint8Array(base64url);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("urlBase64ToUint8Array", () => {
  it("decodes a VAPID public key to 65 bytes", () => {
    expect(urlBase64ToUint8Array(KEY_A)).toHaveLength(65);
  });

  it("treats - and _ as + and /", () => {
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
});

describe("applicationServerKeyMatches", () => {
  it("accepts a subscription made with the current key", () => {
    expect(applicationServerKeyMatches(keyBytes(KEY_A), KEY_A)).toBe(true);
  });

  it("rejects a subscription made with a different key", () => {
    expect(applicationServerKeyMatches(keyBytes(KEY_B), KEY_A)).toBe(false);
  });

  it("rejects a key of a different length", () => {
    expect(applicationServerKeyMatches(keyBytes("-_8"), KEY_A)).toBe(false);
  });

  it("rejects a missing subscription key", () => {
    expect(applicationServerKeyMatches(null, KEY_A)).toBe(false);
    expect(applicationServerKeyMatches(undefined, KEY_A)).toBe(false);
    expect(applicationServerKeyMatches(new ArrayBuffer(0), KEY_A)).toBe(false);
  });

  it("rejects a missing current key", () => {
    expect(applicationServerKeyMatches(keyBytes(KEY_A), "")).toBe(false);
    expect(applicationServerKeyMatches(keyBytes(KEY_A), null)).toBe(false);
  });
});

describe("decideReconcileAction", () => {
  const base = {
    supported: true,
    permission: "granted",
    vapidPublicKey: KEY_A,
    hasSubscription: true,
    keyMatches: true,
  };

  it("re-registers a healthy subscription so a deleted server row comes back", () => {
    expect(decideReconcileAction(base)).toBe("register");
  });

  it("rebuilds the subscription when the key no longer matches", () => {
    expect(decideReconcileAction({ ...base, keyMatches: false })).toBe("resubscribe");
  });

  it("does nothing when the device has no subscription (notifications turned off on purpose)", () => {
    expect(decideReconcileAction({ ...base, hasSubscription: false })).toBe("skip");
  });

  it("never acts without permission, so no prompt can appear", () => {
    expect(decideReconcileAction({ ...base, permission: "default" })).toBe("skip");
    expect(decideReconcileAction({ ...base, permission: "denied" })).toBe("skip");
  });

  it("does nothing when the app has no VAPID public key configured", () => {
    expect(decideReconcileAction({ ...base, vapidPublicKey: undefined })).toBe("skip");
    expect(decideReconcileAction({ ...base, vapidPublicKey: "" })).toBe("skip");
  });

  it("reports unsupported devices before anything else", () => {
    expect(decideReconcileAction({ ...base, supported: false, permission: "denied" })).toBe(
      "unsupported",
    );
  });
});
