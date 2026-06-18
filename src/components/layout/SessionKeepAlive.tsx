"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * セッションをバックグラウンドで更新し続ける常駐コンポーネント。
 *
 * ブラウザ用 Supabase クライアントは autoRefreshToken=true だが、その自動更新は
 * クライアントのインスタンスが「生き続けている間」だけ動く。各操作で都度
 * createClient() して捨てる作りだと常駐クライアントが無く、アクセストークンが
 * 1時間で期限切れになっても更新されず、ログインが切れてしまう。
 *
 * このコンポーネントを (app) レイアウトに置くことで、アプリ表示中は常に
 * トークンが期限切れ前に自動更新され、再ログインが不要になる。
 */
export function SessionKeepAlive() {
  const router = useRouter();
  // クライアントは一度だけ生成して使い回す（常駐させるのが目的）
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (supabaseRef.current === null) {
    supabaseRef.current = createClient();
  }

  useEffect(() => {
    const supabase = supabaseRef.current!;

    // タブが見えている間はトークンを自動更新し続ける。
    // 非表示の間は止め、復帰時に再開（その場で更新が走る）。
    supabase.auth.startAutoRefresh();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        supabase.auth.startAutoRefresh();
      } else {
        supabase.auth.stopAutoRefresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // サインイン/アウトのときだけサーバーコンポーネントへ反映する。
    // TOKEN_REFRESHED は裏で静かにトークンが更新されるだけで表示は変わらないため、
    // ここで router.refresh() すると操作中に全ページ再取得が挟まり、タブ切替や
    // 出欠ボタンが「何度か押さないと反応しない」原因になる。更新後のトークンは
    // クッキーに書かれ、次のナビゲーションでサーバーが読むので refresh は不要。
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      // ログアウト時だけ反映（→ proxy が /login へ誘導）。
      // SIGNED_IN はフォーカス時などに再発火しうるので refresh しない。
      if (event === "SIGNED_OUT") {
        router.refresh();
      }
    });

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      subscription.unsubscribe();
      supabase.auth.stopAutoRefresh();
    };
  }, [router]);

  return null;
}
