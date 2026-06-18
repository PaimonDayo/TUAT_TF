import { cn } from "@/lib/utils";

/** ラベル付きオン/オフトグル（iOS風スイッチ） */
export function Toggle({
  label,
  checked,
  onChange,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        "w-full flex items-center justify-between rounded-xl bg-card border border-separator p-3.5 active:bg-bg",
        className,
      )}
    >
      <span className="text-[14px] text-left">{label}</span>
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
