import { Skeleton } from "@/components/ui/skeleton";

function Title({ action = false }: { action?: boolean }) {
  return <div className="flex h-12 items-center justify-between px-4"><Skeleton className="h-6 w-28" />{action && <Skeleton className="h-8 w-8 rounded-full" />}</div>;
}

function Card({ lines = 2 }: { lines?: number }) {
  return <div className="space-y-3 rounded-[16px] border border-separator bg-card p-4"><div className="flex items-center gap-2.5"><Skeleton className="h-10 w-10 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-2.5 w-20" /></div></div>{Array.from({ length: lines }).map((_, i) => <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />)}</div>;
}

export function HomeSkeleton() {
  return <div className="pb-6"><Title action /><div className="space-y-5 px-4 pt-1"><Skeleton className="h-3 w-24" /><section className="space-y-2"><Skeleton className="h-3 w-20" /><Card lines={2} /></section><section className="space-y-2"><Skeleton className="h-3 w-24" />{[0, 1].map((i) => <Card key={i} lines={i === 0 ? 3 : 1} />)}</section><section className="space-y-2"><Skeleton className="h-3 w-16" />{[0, 1].map((i) => <Skeleton key={i} className="h-[76px] w-full rounded-[16px]" />)}</section><section className="space-y-2"><Skeleton className="h-3 w-24" /><Card lines={2} /></section></div></div>;
}

export function ScheduleSkeleton() {
  return <div className="pb-6"><Title action /><div className="space-y-2 px-4 pb-3 pt-1 md:px-6"><Skeleton className="h-9 w-full rounded-lg md:max-w-[520px]" /><Skeleton className="h-9 w-full rounded-lg md:max-w-[520px]" /></div><div className="space-y-3 px-4 pt-1 md:px-6"><Skeleton className="h-3 w-20" />{[0, 1, 2, 3].map((i) => <Card key={i} lines={i === 0 ? 3 : 1} />)}</div></div>;
}


export function NotesSkeleton() {
  return <div className="pb-6"><Title action /><div className="space-y-4 px-4 pt-1 md:px-6 lg:space-y-3"><Skeleton className="h-9 w-full rounded-lg md:max-w-[360px]" /><Skeleton className="h-10 w-full rounded-xl" /><div className="grid gap-2 md:grid-cols-2 md:gap-3">{[0, 1, 2, 3].map((i) => <div key={i} className="rounded-[16px] border border-separator bg-card p-4"><div className="flex items-start gap-3"><Skeleton className="h-5 w-5 shrink-0 rounded" /><div className="flex-1 space-y-2"><Skeleton className="h-3.5 w-32" /><Skeleton className="h-2.5 w-16" />{i < 2 && <Skeleton className="h-2.5 w-4/5" />}</div><Skeleton className="h-5 w-5 rounded-full" /></div></div>)}</div></div></div>;
}
export function FeedSkeleton({ withHeader = true }: { withHeader?: boolean } = {}) {
  return <div className="pb-6">
    {withHeader && <Title action />}
    <div className="px-4 pb-3 pt-1 md:px-6 lg:pb-2"><div className="flex min-h-9 items-center gap-2"><Skeleton className="h-8 min-w-0 flex-1 rounded-lg md:max-w-[420px]" /><Skeleton className="h-8 w-8 shrink-0 rounded-full" /><Skeleton className="h-8 w-8 shrink-0 rounded-full" /></div></div>
    <div className="space-y-3 px-4 pt-1 md:px-6 lg:space-y-2">{[0, 1, 2, 3].map((i) => <Card key={i} lines={(i % 2) + 1} />)}</div>
  </div>;
}

export function PostDetailSkeleton({ withHeader = false }: { withHeader?: boolean }) {
  return <div className="space-y-4 pb-6">{withHeader && <Title />}<div className="px-4"><Card lines={3} /></div></div>;
}

export function ListSkeleton() {
  return <div className="space-y-4 pb-6"><Title action /><div className="space-y-3 px-4"><Skeleton className="h-10 w-full rounded-xl" /><Skeleton className="h-3 w-16" /><div className="overflow-hidden rounded-[16px] border border-separator bg-card">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="flex items-center gap-3 border-b border-separator px-4 py-3 last:border-0"><Skeleton className="h-9 w-9 rounded-full" /><Skeleton className="h-3.5 w-28" /></div>)}</div></div></div>;
}

export function MyPageSkeleton() {
  return <div className="pb-6"><Title action /><div className="space-y-5 px-4 pt-1"><div className="flex items-center gap-4 rounded-[16px] border border-separator bg-card p-4"><Skeleton className="h-16 w-16 shrink-0 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-5 w-32" /><Skeleton className="h-3 w-20" /><Skeleton className="h-5 w-28 rounded-full" /></div></div><div className="space-y-3 rounded-[16px] border border-separator bg-card p-4"><div className="flex items-center justify-between"><Skeleton className="h-3 w-24" /><Skeleton className="h-7 w-36 rounded-lg" /></div><Skeleton className="h-[100px] w-full" /></div><div className="overflow-hidden rounded-[16px] border border-separator bg-card">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="flex h-[53px] items-center gap-3 border-b border-separator px-4 last:border-0"><Skeleton className="h-5 w-5 rounded" /><Skeleton className="h-3.5 w-32" /></div>)}</div><section className="space-y-2"><Skeleton className="h-3 w-20" /><div className="overflow-hidden rounded-[16px] border border-separator bg-card"><Skeleton className="m-4 h-5 w-40" /></div></section><section className="space-y-2"><Skeleton className="h-3 w-24" />{[0, 1].map((i) => <Card key={i} lines={1} />)}</section></div></div>;
}
