import Link from "next/link";
import { Bell } from "lucide-react";

/** 全タブ統一ヘッダー（高さ48px / 右にベルアイコン固定） */
export function Header({
  title,
  large = false,
  right,
}: {
  title: string;
  large?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
      <div className="h-12 px-4 flex items-center justify-between">
        <h1 className={large ? "text-large-title" : "text-title"}>{title}</h1>
        <div className="flex items-center gap-1">
          {right}
          <Link
            href="/notices"
            aria-label="お知らせ"
            className="h-9 w-9 flex items-center justify-center text-accent active:opacity-50"
          >
            <Bell size={22} strokeWidth={2} />
          </Link>
        </div>
      </div>
    </header>
  );
}
