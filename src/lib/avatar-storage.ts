import type { createClient } from "@/lib/supabase/client";

type BrowserClient = ReturnType<typeof createClient>;

type StorageFailure = {
  message?: string;
  status?: number;
  statusCode?: string;
};

function isAuthenticationFailure(error: StorageFailure): boolean {
  const status = error.status ?? Number(error.statusCode);
  return (
    status === 401 ||
    status === 403 ||
    /auth|jwt|row-level security|policy/i.test(error.message ?? "")
  );
}

/**
 * 長時間開いたPWAでは、画面表示に使えたCookieより先にStorage用JWTが期限切れに
 * なっていることがある。認証系エラーに限ってセッションを更新し、同じパスへ一度だけ
 * 再アップロードする。
 */
export async function uploadAvatarWithSessionRetry(
  supabase: BrowserClient,
  bucket: string,
  path: string,
  image: Blob,
): Promise<void> {
  const upload = () =>
    supabase.storage.from(bucket).upload(path, image, {
      cacheControl: "31536000",
      contentType: "image/webp",
      upsert: false,
    });

  let { error } = await upload();
  if (error && isAuthenticationFailure(error)) {
    const { error: refreshError } = await supabase.auth.refreshSession();
    if (!refreshError) {
      ({ error } = await upload());
    }
  }

  if (error) {
    console.error("Failed to upload avatar", {
      message: error.message,
      status: error.status,
      statusCode: error.statusCode,
    });
    throw new Error(
      isAuthenticationFailure(error)
        ? "ログイン状態を更新できませんでした。画面を開き直してから、もう一度お試しください"
        : "画像をアップロードできませんでした。もう一度お試しください",
    );
  }
}
