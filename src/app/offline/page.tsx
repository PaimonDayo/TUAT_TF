import Link from "next/link";
import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center bg-bg px-6">
      <div className="w-full rounded-2xl border border-separator bg-card p-6 text-center">
        <WifiOff className="mx-auto text-muted2" size={30} aria-hidden="true" />
        <h1 className="mt-3 text-title">{"\u30aa\u30d5\u30e9\u30a4\u30f3\u3067\u3059"}</h1>
        <p className="mt-2 text-body text-muted2">
          {"\u6700\u65b0\u306e\u8a18\u9332\u30fb\u4e88\u5b9a\u30fb\u51fa\u6b20\u3092\u5b89\u5168\u306b\u8868\u793a\u3059\u308b\u305f\u3081\u3001\u30c7\u30fc\u30bf\u306f\u7aef\u672b\u306b\u4fdd\u5b58\u3057\u3066\u3044\u307e\u305b\u3093\u3002"}
        </p>
        <Link
          href="/home"
          className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-accent px-4 text-[15px] font-semibold text-white"
        >
          {"\u63a5\u7d9a\u5f8c\u306b\u518d\u8a66\u884c"}
        </Link>
      </div>
    </main>
  );
}
