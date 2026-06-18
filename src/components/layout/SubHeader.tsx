import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { BackButton } from "@/components/layout/BackButton";

/**
 * サブページ用の統一ヘッダー（左に戻る・中央にタイトル・高さ48px）。
 * backHref を渡すとそのページへ、省略すると直前のページ（ブラウザ履歴）へ戻る。
 */
export function SubHeader({
  title,
  backHref,
  backLabel = "戻る",
  right,
}: {
  title: string;
  backHref?: string;
  backLabel?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
      <div className="h-12 px-2 grid grid-cols-[1fr_auto_1fr] items-center">
        {backHref ? (
          <Link
            href={backHref}
            className="justify-self-start h-9 pl-1 pr-2 flex items-center gap-0.5 text-accent active:opacity-50 text-[15px]"
          >
            <ChevronLeft size={24} />
            {backLabel}
          </Link>
        ) : (
          <BackButton label={backLabel} />
        )}
        <h1 className="text-title text-center whitespace-nowrap">{title}</h1>
        <div className="justify-self-end flex items-center pr-1">{right}</div>
      </div>
    </header>
  );
}
