import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/** サブページ用の統一ヘッダー（左に戻る・中央にタイトル・高さ48px） */
export function SubHeader({
  title,
  backHref,
  backLabel = "戻る",
  right,
}: {
  title: string;
  backHref: string;
  backLabel?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
      <div className="h-12 px-2 grid grid-cols-[1fr_auto_1fr] items-center">
        <Link
          href={backHref}
          className="justify-self-start h-9 pl-1 pr-2 flex items-center gap-0.5 text-accent active:opacity-50 text-[15px]"
        >
          <ChevronLeft size={24} />
          {backLabel}
        </Link>
        <h1 className="text-title text-center whitespace-nowrap">{title}</h1>
        <div className="justify-self-end flex items-center pr-1">{right}</div>
      </div>
    </header>
  );
}
