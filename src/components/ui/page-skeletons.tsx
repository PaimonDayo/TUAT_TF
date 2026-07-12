import { Skeleton } from "@/components/ui/skeleton";

function Title({ action = false }: { action?: boolean }) {
  return <div className="flex h-12 items-center justify-between px-4"><Skeleton className="h-6 w-28" />{action && <Skeleton className="h-8 w-8 rounded-full" />}</div>;
}

function Card({ lines = 2 }: { lines?: number }) {
  return <div className="space-y-3 rounded-[16px] border border-separator bg-card p-4"><div className="flex items-center gap-2.5"><Skeleton className="h-9 w-9 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-2.5 w-20" /></div></div>{Array.from({ length: lines }).map((_, i) => <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />)}</div>;
}

export function HomeSkeleton() {
  return <div className="space-y-6 pb-6"><Title action /><section className="space-y-3 px-4"><Skeleton className="h-4 w-20" /><Card lines={3} /></section><section className="space-y-3 px-4"><Skeleton className="h-4 w-24" />{[0, 1, 2].map((i) => <Card key={i} lines={1} />)}</section><section className="space-y-3 px-4"><Skeleton className="h-4 w-20" />{[0, 1].map((i) => <Card key={i} />)}</section></div>;
}

export function ScheduleSkeleton() {
  return <div className="space-y-4 pb-6"><Title action /><div className="px-4 pb-3 pt-1"><Skeleton className="h-9 w-full rounded-xl" /></div><div className="space-y-3 px-4 pt-1"><Skeleton className="h-3 w-20" />{[0, 1, 2, 3].map((i) => <Card key={i} lines={i === 0 ? 3 : 1} />)}</div></div>;
}

export function FeedSkeleton() {
  return <div className="space-y-4 pb-6"><Title action /><div className="flex gap-2 overflow-hidden px-4"><Skeleton className="h-8 w-16 rounded-full" /><Skeleton className="h-8 w-20 rounded-full" /><Skeleton className="h-8 w-16 rounded-full" /></div><div className="space-y-3 px-4">{[0, 1, 2, 3].map((i) => <Card key={i} lines={(i % 2) + 1} />)}</div></div>;
}

export function ListSkeleton() {
  return <div className="space-y-4 pb-6"><Title action /><div className="space-y-3 px-4"><Skeleton className="h-10 w-full rounded-xl" /><Skeleton className="h-3 w-16" /><div className="overflow-hidden rounded-[16px] border border-separator bg-card">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="flex items-center gap-3 border-b border-separator px-4 py-3 last:border-0"><Skeleton className="h-9 w-9 rounded-full" /><Skeleton className="h-3.5 w-28" /></div>)}</div></div></div>;
}

export function MyPageSkeleton() {
  return <div className="space-y-5 pb-6"><Title action /><div className="flex items-center gap-3 px-4"><Skeleton className="h-16 w-16 rounded-full" /><div className="space-y-2"><Skeleton className="h-5 w-28" /><Skeleton className="h-3 w-20" /></div></div><div className="space-y-3 px-4"><Skeleton className="h-4 w-20" /><Skeleton className="h-36 w-full rounded-[16px]" /></div><div className="space-y-2 px-4"><Skeleton className="h-4 w-16" />{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full rounded-xl" />)}</div></div>;
}
