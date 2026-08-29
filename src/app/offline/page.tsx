import Link from "next/link";
import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center bg-bg px-6">
      <div className="w-full rounded-2xl border border-separator bg-card p-6 text-center">
        <WifiOff className="mx-auto text-muted2" size={30} aria-hidden="true" />
        <h1 className="mt-3 text-title">{"オフラインです"}</h1>
        <p className="mt-2 text-body text-muted2">
          {"最新の記録・予定・出欠を安全に表示するため、データは端末に保存していません。"}
        </p>
        <Link
          href="/home"
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-4 text-[15px] font-semibold text-white"
        >
          {"接続後に再試行"}
        </Link>
      </div>
    </main>
  );
}
