import { cn, initials } from "@/lib/utils";
import { BLOCKS } from "@/lib/constants";
import type { Block } from "@/types";

const SIZES = {
  sm: "h-8 w-8 text-[13px]",
  md: "h-10 w-10 text-[15px]",
  lg: "h-16 w-16 text-2xl",
};

/** イニシャル表示アバター。ブロックがあれば先頭ブロックの色で着色 */
export function Avatar({
  name,
  blocks,
  avatarUrl,
  size = "md",
  className,
}: {
  name: string;
  blocks?: Block[] | null;
  avatarUrl?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const primary = blocks && blocks.length > 0 ? blocks[0] : null;
  const color = primary ? BLOCKS[primary].color : "#8e8e93";
  const bg = primary ? BLOCKS[primary].bg : "#e5e5ea";

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        className={cn("rounded-full object-cover", SIZES[size], className)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full font-semibold shrink-0",
        SIZES[size],
        className,
      )}
      style={{ backgroundColor: bg, color }}
    >
      {initials(name)}
    </div>
  );
}
