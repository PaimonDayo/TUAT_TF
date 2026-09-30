import type { ReactNode } from "react";

export const floatingActionButtonClass = "pointer-events-auto absolute right-5 bottom-[calc(74px+env(safe-area-inset-bottom))] flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 pressable lg:bottom-8 lg:right-8 lg:h-12 lg:w-12";

export function FloatingActionPosition({ children }: { children: ReactNode }) {
  return <div className="app-floating-action pointer-events-none fixed inset-x-0 bottom-0 z-40 mx-auto h-0 w-full max-w-md md:inset-x-auto md:right-3 md:w-0 md:max-w-none lg:right-[max(0px,calc((100vw-1160px)/2))]">{children}</div>;
}
