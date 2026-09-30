"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Home, Newspaper, CalendarDays, NotebookTabs, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { syncVisualViewport } from "@/lib/viewport-sync";
import { isIOSGlassDevice } from "@/lib/ios-glass";
import "./glass/glass-nav.css";

const subscribeToMobile = (changed: () => void) => {
  const query = matchMedia("(max-width: 767px)");
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
};
const glassDeviceSnapshot = () => isIOSGlassDevice(navigator) && matchMedia("(max-width: 767px)").matches;

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
      aria-busy={pending}
      className={cn(
        "flex h-full flex-col items-center justify-center gap-0.5 transition-colors duration-150",
        highlighted ? "text-accent" : "text-muted",
      )}
    >
      <Icon size={22} strokeWidth={highlighted ? 2.4 : 2} className={pending ? "motion-safe:animate-pulse" : undefined} />
      <span className="text-[10px] font-medium leading-none">{label}</span>
      {pending && <span className="sr-only" role="status">読み込み中</span>}
    </span>
  );
}

export function BottomNav({ canUseGlass = false }: { canUseGlass?: boolean }) {
  const pathname = usePathname();
  const mounted = useSyncExternalStore(subscribeToClient, () => true, () => false);
  const eligibleDevice = useSyncExternalStore(subscribeToMobile, glassDeviceSnapshot, () => false);
  const glass = canUseGlass && eligibleDevice;
  const navRef = useRef<HTMLElement | null>(null);
  const controller = useRef<{ update: (index: number) => void; destroy: () => void } | null>(null);
  const activeIndex = ITEMS.findIndex(({ href }) => pathname === href || pathname.startsWith(href + "/"));
  const selected = useRef(activeIndex);
  useEffect(() => {
    if (mounted && navRef.current) return syncVisualViewport(navRef.current, "bottom");
  }, [glass, mounted]);

  useEffect(() => {
    selected.current = activeIndex;
    controller.current?.update(activeIndex);
  }, [activeIndex]);

  useEffect(() => {
    if (!glass || !mounted || !navRef.current) return;
    const element = navRef.current;
    let disposed = false;
    // Neither the optical engine nor its vendor script loads for other members/devices.
    void import("./glass/mount-glass").then(({ mountGlass }) => {
      if (!disposed) controller.current = mountGlass(element, selected.current);
    }).catch(() => { /* CSS glass and normal Links remain usable if loading fails. */ });
    return () => {
      disposed = true;
      controller.current?.destroy();
      controller.current = null;
    };
  }, [glass, mounted]);

  if (!mounted) return null;

  return createPortal(
    <nav
      ref={navRef}
      data-no-pull-refresh
      aria-label="メインナビゲーション"
      className={cn("fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md md:hidden",
        glass ? "ios-glass-nav" : "border-t border-separator bg-card pb-[env(safe-area-inset-bottom)]")}
    >
      <div className={glass ? "glass-bar" : undefined} data-glass={glass ? "true" : undefined}>
      <div className={glass ? "nav-items" : "h-[52px] flex items-stretch"}>
        {glass && <span aria-hidden="true" className="selection" style={{ transform: `translateX(${Math.max(0, activeIndex) * 100}%)`, visibility: activeIndex < 0 ? "hidden" : undefined }} />}
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
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                if (pathname === href) {
                  event.preventDefault();
                  window.scrollTo({ top: 0, behavior: "instant" });
                } else if (pathname.startsWith("/competitions/") && pathname.endsWith("/program")) {
                  // iOS PWA can leave the Next router stuck after opening the live program.
                  // Use the browser's document navigation for bottom tabs from this screen.
                  event.preventDefault();
                  window.location.assign(href);
                }
              }}
              aria-current={active ? "page" : undefined}
              className={glass ? "nav-button" : "flex-1"}
            >
              <TabContent label={label} Icon={Icon} active={active} />
            </Link>
          );
        })}
      </div>
      </div>
    </nav>,
    document.body,
  );
}
