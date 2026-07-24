import { describe, expect, it, vi } from "vitest";
import type { createClient } from "@/lib/supabase/client";
import { uploadAvatarWithSessionRetry } from "@/lib/avatar-storage";

type BrowserClient = ReturnType<typeof createClient>;

function clientWithResults(
  results: Array<{ error: null | { message: string; status?: number; statusCode?: string } }>,
) {
  const upload = vi.fn();
  for (const result of results) upload.mockResolvedValueOnce(result);
  const refreshSession = vi.fn().mockResolvedValue({ error: null });
  const client = {
    storage: { from: vi.fn(() => ({ upload })) },
    auth: { refreshSession },
  } as unknown as BrowserClient;
  return { client, refreshSession, upload };
}

describe("uploadAvatarWithSessionRetry", () => {
  const image = new Blob(["avatar"], { type: "image/webp" });

  it("uploads once when the session is valid", async () => {
    const { client, refreshSession, upload } = clientWithResults([{ error: null }]);

    await uploadAvatarWithSessionRetry(client, "avatars", "user/avatar.webp", image);

    expect(upload).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("refreshes the session and retries an authentication failure", async () => {
    const { client, refreshSession, upload } = clientWithResults([
      { error: { message: "JWT expired", status: 401 } },
      { error: null },
    ]);

    await uploadAvatarWithSessionRetry(client, "avatars", "user/avatar.webp", image);

    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-authentication storage failure", async () => {
    const { client, refreshSession, upload } = clientWithResults([
      { error: { message: "Payload too large", status: 413 } },
    ]);

    await expect(
      uploadAvatarWithSessionRetry(client, "avatars", "user/avatar.webp", image),
    ).rejects.toThrow("画像をアップロードできませんでした");

    expect(refreshSession).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
