import { cn } from "@/lib/utils";

/** ラベル付きオン/オフトグル（iOS風スイッチ） */
export function Toggle({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  variant = "card",
  className,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  /** card=単独のカード / row=設定一覧の中の1行（枠なし・親カードの区切り線に乗る） */
  variant?: "card" | "row";
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      className={cn(
        "w-full flex items-center justify-between active:bg-bg disabled:cursor-not-allowed disabled:opacity-50",
        variant === "card"
          ? "rounded-xl bg-card border border-separator p-3.5 lg:rounded-lg lg:px-3 lg:py-2.5"
          : "bg-transparent px-4 py-3",
        className,
      )}
    >
      <span className="min-w-0 text-left">
        <span className="block text-[14px] font-medium">{label}</span>
        {description && <span className="block text-micro">{description}</span>}
      </span>
      <span
        className="h-6 w-10 rounded-full p-0.5 transition-colors flex shrink-0 ml-3"
        style={{
          backgroundColor: checked ? "#34c759" : "#e5e5ea",
          justifyContent: checked ? "flex-end" : "flex-start",
        }}
      >
        <span className="h-5 w-5 rounded-full bg-white shadow" />
      </span>
    </button>
  );
}
