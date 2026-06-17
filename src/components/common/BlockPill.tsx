import { Badge } from "@/components/ui/badge";
import { BLOCKS } from "@/lib/constants";
import type { Block } from "@/types";

/** ブロック別ピル（単体） */
export function BlockPill({ block, full = false }: { block: Block; full?: boolean }) {
  const b = BLOCKS[block];
  return (
    <Badge style={{ backgroundColor: b.bg, color: b.color }}>
      {full ? b.label : b.short}
    </Badge>
  );
}

/** 複数ブロックのピル列 */
export function BlockPills({ blocks, full = false }: { blocks: Block[] | null; full?: boolean }) {
  if (!blocks || blocks.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {blocks.map((b) => (
        <BlockPill key={b} block={b} full={full} />
      ))}
    </span>
  );
}
