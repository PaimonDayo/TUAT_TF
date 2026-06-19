import { Skeleton } from "@/components/ui/skeleton";

/** タブ移動時に即座に表示されるスケルトン（体感速度の向上） */
export default function Loading() {
  return (
    <div>
      {/* ヘッダー */}
      <div className="h-12 px-4 flex items-center">
        <Skeleton className="h-6 w-32" />
      </div>

      {/* コンテンツのスケルトン */}
      <div className="px-4 pt-1 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-20 rounded-[16px]" />
          <Skeleton className="h-20 rounded-[16px]" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-[16px] bg-card border border-separator p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-2.5 w-20 bg-bg" />
              </div>
            </div>
            <Skeleton className="h-2.5 w-full rounded-full" />
            <Skeleton className="h-12 w-full rounded-lg bg-bg" />
          </div>
        ))}
      </div>
    </div>
  );
}
