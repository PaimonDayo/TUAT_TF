"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Home, Newspaper, CalendarDays, NotebookTabs, User } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/home", label: "ホーム", icon: Home },
  { href: "/schedule", label: "予定", icon: CalendarDays },
  { href: "/timeline", label: "タイムライン", icon: Newspaper },
  { href: "/notes", label: "ノート", icon: NotebookTabs },
  { href: "/mypage", label: "マイページ", icon: User },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const { href } of ITEMS) router.prefetch(href);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [router]);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md border-t border-separator bg-card/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
      <div className="h-[52px] flex items-stretch">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              prefetch
              onMouseEnter={() => router.prefetch(href)}
              onTouchStart={() => router.prefetch(href)}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-0.5",
                active ? "text-accent" : "text-muted",
              )}
            >
              <Icon size={22} strokeWidth={active ? 2.4 : 2} />
              <span className="text-[10px] font-medium leading-none">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
