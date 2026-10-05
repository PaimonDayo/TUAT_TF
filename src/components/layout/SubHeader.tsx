import { BackButton } from "@/components/layout/BackButton";

/**
 * サブページ用の統一ヘッダー（左に「‹戻る」・中央にタイトル・高さ48px）。
 * 戻るは常に「直前のページ（履歴）」へ。履歴が無い場合だけ backHref（fallback）へ。
 * これで「どこから開いても直前に戻る」が全ページで統一される。
 */
export function SubHeader({
  title,
  backHref,
  forceBackHref = false,
  right,
  sideWidth,
}: {
  title: string;
  backHref?: string;
  forceBackHref?: boolean;
  right?: React.ReactNode;
  sideWidth?: number;
}) {
  return (
    <header data-glass-header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-xl pt-[env(safe-area-inset-top)] lg:pt-0">
      <div data-new-ui-subheader-layout className="flex h-12 items-center gap-2 px-2 md:px-4 lg:h-16">
        <BackButton fallback={backHref ?? "/home"} forceFallback={forceBackHref} />
        <h1 data-new-ui-title className="min-w-0 flex-1 truncate text-title text-center" title={title}>{title}</h1>
        <div style={sideWidth ? { minWidth: sideWidth } : undefined} className="flex min-w-11 shrink-0 items-center justify-end gap-2">{right}</div>
      </div>
    </header>
  );
}
