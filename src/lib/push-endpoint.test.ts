import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "../../supabase/functions/send-web-push/endpoint";

describe("push destinations", () => {
  it("accepts supported browser services", () => {
    for (const host of ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "push.apple.com"]) {
      expect(isAllowedPushEndpoint(`https://${host}/subscription/token`)).toBe(true);
    }
  });
  it("rejects other authorities and URL normalization ambiguities", () => {
    for (const value of [null, "http://fcm.googleapis.com/a", "https://fcm.googleapis.com.evil.example/a", "https://user@fcm.googleapis.com/a", "https://fcm.googleapis.com:443/a", "https://fcm.googleapis.com/a#fragment", "https://fcm.googleapis.com/a\\b", "https://fcm.googleapis.com/a\nb", "https://127.0.0.1/a", "https://fcm.googleapis.com/"]) {
      expect(isAllowedPushEndpoint(value)).toBe(false);
    }
  });
});
