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

/** サブページ共通の見出し（左に戻る・中央にタイトル）。SubHeader と同じ高さ。 */
function SubTitle() {
  return <div className="grid h-12 grid-cols-[1fr_auto_1fr] items-center px-2 md:px-4 lg:h-16"><Skeleton className="h-5 w-14" /><Skeleton className="h-5 w-32" /><span /></div>;
}

function Label() {
  return <Skeleton className="h-3 w-24" />;
}

/** カード1枚に区切り線で行を並べた形（一覧・設定系で共通） */
function Rows({ count, height = 56 }: { count: number; height?: number }) {
  return <div className="overflow-hidden rounded-[16px] border border-separator bg-card">{Array.from({ length: count }).map((_, i) => <div key={i} className="flex items-center gap-3 border-b border-separator px-4 last:border-0" style={{ height }}><Skeleton className="h-3.5 flex-1 max-w-[60%]" /><Skeleton className="ml-auto h-3.5 w-12" /></div>)}</div>;
}

export function GoalsSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-5 px-4 pt-2">
    <section className="space-y-2"><Label /><div className="space-y-3 rounded-[16px] border border-separator bg-card p-4"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-9 w-32 rounded-lg" /></div></section>
    <section className="space-y-2"><Label /><Rows count={3} /><Skeleton className="mx-1 h-2.5 w-56" /></section>
    <section className="space-y-2"><Label /><Rows count={1} /></section>
  </div></div>;
}

export function PastGoalsSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="px-4 pt-2"><Rows count={5} /></div></div>;
}

/** 種目・大会の管理画面（並べ替えできる一覧＋追加欄） */
export function CatalogueSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-3 px-4 pt-2"><Skeleton className="h-10 w-full rounded-xl" /><Rows count={8} /></div></div>;
}

export function CompetitionSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-3 px-4 pt-2"><Skeleton className="h-3 w-32" /><Skeleton className="h-[60px] w-full rounded-[16px]" />{[0, 1].map((i) => <section key={i} className="space-y-2"><Label /><Rows count={3} /></section>)}</div></div>;
}

export function CompetitionGoalsSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-3 px-4 pt-2"><Skeleton className="h-9 w-full rounded-lg" /><Skeleton className="h-8 w-full rounded-lg" /><Rows count={6} /></div></div>;
}

export function ResultsSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="px-4 pt-2"><Rows count={6} /></div></div>;
}

export function BlogListSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-4 px-4 pt-1 md:px-6"><div className="space-y-1.5"><Skeleton className="h-4 w-56" /><Skeleton className="h-2.5 w-32" /></div><div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="space-y-2 rounded-[16px] border border-separator bg-card p-4"><Skeleton className="h-2.5 w-24" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-1/2" /></div>)}</div></div></div>;
}

export function BlogArticleSkeleton() {
  return <div className="pb-8"><SubTitle /><div className="px-4 pt-1 md:px-6"><div className="rounded-[16px] border border-separator bg-card px-4 py-5 sm:px-6"><div className="space-y-2 border-b border-separator pb-4"><Skeleton className="h-2.5 w-28" /><Skeleton className="h-5 w-3/4" /></div><div className="space-y-3 pt-4">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className={`h-3 ${i % 3 === 2 ? "w-2/3" : "w-full"}`} />)}</div></div></div></div>;
}

export function MemberSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-5 px-4 pt-1">
    <div className="flex items-center gap-4 rounded-[16px] border border-separator bg-card p-4"><Skeleton className="h-16 w-16 shrink-0 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-5 w-32" /><Skeleton className="h-3 w-20" /><Skeleton className="h-5 w-28 rounded-full" /></div></div>
    <section className="space-y-2"><Label />{[0, 1].map((i) => <Card key={i} lines={(i % 2) + 1} />)}</section>
  </div></div>;
}

export function NoteFolderSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-4 px-4 pt-1"><Skeleton className="h-9 w-full rounded-lg" /><section className="space-y-2"><Label /><Rows count={2} /></section><section className="space-y-2"><Label /><Rows count={4} /></section></div></div>;
}

export function NoteArticleSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="px-4 pt-1"><div className="space-y-4 rounded-[16px] border border-separator bg-card p-4"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-2.5 w-32" />{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className={`h-3 ${i === 4 ? "w-1/2" : "w-full"}`} />)}</div></div></div>;
}

export function ThreadSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-4 px-4 pt-1"><Skeleton className="h-5 w-2/3" />{[0, 1, 2].map((i) => <Card key={i} lines={(i % 2) + 1} />)}<Skeleton className="h-24 w-full rounded-[16px]" /></div></div>;
}

export function ServiceStatusSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-3 px-4 pt-2">{[0, 1, 2].map((i) => <div key={i} className="space-y-3 rounded-[16px] border border-separator bg-card p-4"><Skeleton className="h-3.5 w-32" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div>)}</div></div>;
}
