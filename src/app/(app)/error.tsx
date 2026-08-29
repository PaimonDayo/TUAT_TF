"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("App route failed to render", { error, digest: error.digest });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60dvh] max-w-md items-center justify-center px-6">
      <div className="w-full rounded-2xl border border-separator bg-card p-6 text-center">
        <AlertTriangle className="mx-auto text-danger" size={28} aria-hidden="true" />
        <h1 className="mt-3 text-title">{"データを取得できませんでした"}</h1>
        <p className="mt-2 text-body text-muted2">
          {"通信状態を確認して、もう一度お試しください。"}
        </p>
        <Button className="mt-5 w-full" onClick={() => unstable_retry()}>
          <RefreshCw size={18} aria-hidden="true" />
          {"再試行"}
        </Button>
      </div>
    </main>
  );
}
