"use client";

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { APP_NAME, APP_MONO } from "@/lib/app";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [embeddedBrowser, setEmbeddedBrowser] = useState<EmbeddedBrowser | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // userAgent はブラウザでのみ確定するため、マウント後に案内を切り替える。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEmbeddedBrowser(detectEmbeddedBrowser(window.navigator.userAgent));
  }, []);

  async function signInWithGoogle() {
    const embedded = detectEmbeddedBrowser(window.navigator.userAgent);
    if (embedded) {
      setEmbeddedBrowser(embedded);
      return;
    }
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const domain = process.env.NEXT_PUBLIC_UNIVERSITY_DOMAIN;
    const next =
      new URLSearchParams(window.location.search).get("next") ?? "/home";

    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        queryParams: domain ? { hd: domain, prompt: "select_account" } : {},
      },
    });

    if (signInError) {
      setError("ログインに失敗しました。もう一度お試しください。");
      setLoading(false);
    }
  }

  async function copyCurrentUrl() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("このURLをコピーしてください", window.location.href);
    }
  }

  function openInChrome() {
    const { host, pathname, search, hash } = window.location;
    window.location.href = `intent://${host}${pathname}${search}${hash}#Intent;scheme=https;package=com.android.chrome;end`;
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center px-8 max-w-md mx-auto">
      <div className="flex flex-col items-center gap-3 mb-12">
        <div className="h-20 w-20 rounded-[22px] bg-accent flex items-center justify-center shadow-lg shadow-accent/20">
          <span className="text-white text-[26px] font-extrabold tracking-tight">
            {APP_MONO}
          </span>
        </div>
        <h1 className="text-large-title">{APP_NAME}</h1>
        <p className="text-body text-muted text-center">
          練習記録・予定・ノートを
          <br />
          部内で共有しよう
        </p>
      </div>

      <div className="w-full space-y-3">
        {embeddedBrowser ? (
          <div className="space-y-3 rounded-2xl border border-warning/40 bg-warning/8 p-4">
            <div>
              <p className="text-headline">ブラウザで開いてください</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted2">
                {embeddedBrowser.name}内のブラウザでは、Googleのセキュリティ制限によりログインできません。
              </p>
            </div>
            {embeddedBrowser.android ? (
              <Button size="lg" onClick={openInChrome} className="gap-2">
                <ExternalLink size={17} /> Chromeで開く
              </Button>
            ) : (
              <p className="rounded-xl bg-card p-3 text-[13px] leading-relaxed">
                画面右上または右下のメニューから
                <span className="font-semibold">「デフォルトのブラウザで開く」</span>
                を選んでください。
              </p>
            )}
            <Button size="lg" variant="outline" onClick={copyCurrentUrl} className="gap-2">
              {copied ? <Check size={17} /> : <Copy size={17} />}
              {copied ? "URLをコピーしました" : "URLをコピー"}
            </Button>
          </div>
        ) : (
          <Button
            size="lg"
            variant="outline"
            onClick={signInWithGoogle}
            disabled={loading}
            className="gap-3"
          >
            <GoogleIcon />
            {loading ? "ログイン中..." : "Googleでログイン"}
          </Button>
        )}

        {error && <p className="text-caption text-danger text-center">{error}</p>}

        <p className="text-micro text-center pt-2">
          大学のGoogleアカウント（{process.env.NEXT_PUBLIC_UNIVERSITY_DOMAIN}）
          <br />
          でのみログインできます
        </p>
      </div>
    </main>
  );
}

type EmbeddedBrowser = { name: string; android: boolean };

function detectEmbeddedBrowser(userAgent: string): EmbeddedBrowser | null {
  const ua = userAgent.toLowerCase();
  const android = ua.includes("android");
  if (/\bline\//i.test(userAgent)) return { name: "LINE", android };
  if (ua.includes("instagram")) return { name: "Instagram", android };
  if (ua.includes("fban") || ua.includes("fbav")) return { name: "Facebook", android };
  if (ua.includes("twitter") || ua.includes("x-client")) return { name: "X", android };
  if (ua.includes("tiktok")) return { name: "TikTok", android };
  // iOSの一般的なWebViewはSafariの識別子を持たない。
  if (/iphone|ipad|ipod/.test(ua) && /applewebkit/.test(ua) && !/safari/.test(ua)) {
    return { name: "アプリ", android: false };
  }
  return null;
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
