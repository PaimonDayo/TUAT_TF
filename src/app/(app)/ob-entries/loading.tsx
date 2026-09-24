import { SubHeader } from "@/components/layout/SubHeader";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <><SubHeader title="OB戦エントリー" backHref="/mypage" />
    <div className="space-y-4 px-4 pb-8 pt-2" role="status" aria-label="エントリーを読み込み中">
      <Card className="space-y-3 p-4"><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-28" /></Card>
      <Skeleton className="h-9 w-full" /><Skeleton className="h-10 w-full" />
      <Card className="space-y-4 p-3.5">{[0,1,2,3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</Card>
    </div>
  </>;
}
