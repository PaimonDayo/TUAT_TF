import { BackButton } from "@/components/layout/BackButton";

/**
 * サブページ用の統一ヘッダー（左に「‹戻る」・中央にタイトル・高さ48px）。
 * 戻るは常に「直前のページ（履歴）」へ。履歴が無い場合だけ backHref（fallback）へ。
 * これで「どこから開いても直前に戻る」が全ページで統一される。
 */
export function SubHeader({
  title,
  backHref,
  right,
}: {
  title: string;
  backHref?: string;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-30 bg-bg/80 backdrop-blur-xl pt-[env(safe-area-inset-top)]">
      <div className="h-12 px-2 grid grid-cols-[1fr_auto_1fr] items-center">
        <BackButton fallback={backHref ?? "/home"} />
        <h1 className="text-title text-center whitespace-nowrap">{title}</h1>
        <div className="justify-self-end flex items-center pr-1">{right}</div>
      </div>
    </header>
  );
}
