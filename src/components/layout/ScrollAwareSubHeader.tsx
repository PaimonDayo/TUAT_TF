"use client";

import { useEffect, useRef, useState } from "react";
import { BackButton } from "@/components/layout/BackButton";
import { cn } from "@/lib/utils";
import { useSystemGlass } from "@/components/layout/glass/system-glass-state";

export function ScrollAwareSubHeader({ title, backHref }: { title: string; backHref: string }) {
  const systemGlass = useSystemGlass();
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    function onScroll() {
      const currentY = window.scrollY;
      const delta = currentY - lastY.current;
      if (currentY < 24) setVisible(true);
      else if (delta > 8) setVisible(false);
      else if (delta < -6) setVisible(true);
      lastY.current = currentY;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header data-glass-header className={cn("sticky top-0 z-30 bg-bg/90 backdrop-blur-xl pt-[env(safe-area-inset-top)] transition-transform duration-200 lg:pt-0", !visible && "-translate-y-full")}>
      <div className={cn("grid h-12 items-center px-2 md:px-4 lg:h-16", systemGlass
        ? "grid-cols-[minmax(44px,1fr)_minmax(0,2fr)_minmax(44px,1fr)]"
        : "grid-cols-[minmax(72px,1fr)_minmax(0,2fr)_minmax(72px,1fr)]")}>
        <BackButton fallback={backHref} />
        <h1 className="truncate text-center text-title" title={title}>{title}</h1>
        <div />
      </div>
    </header>
  );
}
