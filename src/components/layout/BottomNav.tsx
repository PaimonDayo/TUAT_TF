"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Home, Newspaper, CalendarDays, NotebookTabs, User } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/home", label: "ホーム", icon: Home },
  { href: "/schedule", label: "予定", icon: CalendarDays },
  { href: "/timeline", label: "タイムライン", icon: Newspaper },
  { href: "/notes", label: "ノート", icon: NotebookTabs },
  { href: "/mypage", label: "マイページ", icon: User },
];

const subscribeToClient = () => () => {};

/**
 * タブの中身。`useLinkStatus` は Link の中でしか使えないので子に分けてある。
 *
 * 回線が遅いときは先読みが間に合わず、タップしてから画面が変わるまでに間があく。
 * そのあいだ古いタブが選ばれたままだと「押せていない」ように見えるので、
 * 遷移が始まった時点で押したタブを選択済みとして描く。色が変わるだけで
 * 位置は動かさない（拡大縮小はこのアプリでは使わない）。
 */
function TabContent({
  label,
  Icon,
  active,
}: {
  label: string;
  Icon: typeof Home;
  active: boolean;
}) {
  const { pending } = useLinkStatus();
  const highlighted = active || pending;
  return (
    <span
      className={cn(
        "flex h-full flex-col items-center justify-center gap-0.5 transition-colors duration-150",
        highlighted ? "text-accent" : "text-muted",
      )}
    >
      <Icon size={22} strokeWidth={highlighted ? 2.4 : 2} />
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </span>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const mounted = useSyncExternalStore(subscribeToClient, () => true, () => false);

  if (!mounted) return null;

  return createPortal(
    <nav
      aria-label="メインナビゲーション"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t border-separator bg-card/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="h-[52px] flex items-stretch">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            // prefetch は既定のまま（切らない）。5つのタブにはどれも loading.tsx が
            // あるので、先読みされるのは共通レイアウトとスケルトンだけで、ページの
            // 取得処理＝DBへの問い合わせは走らない。これでタップした瞬間に
            // スケルトンが出る。切ると、まずスケルトンを取りに行くところから
            // 始まるので、タップしてしばらく何も起きないように見える。
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className="flex-1"
            >
              <TabContent label={label} Icon={Icon} active={active} />
            </Link>
          );
        })}
      </div>
    </nav>,
    document.body,
  );
}
