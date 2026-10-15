import type { ReactNode } from "react";
import { Card as Panel } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

function LoadingRegion({ label, children, className = "pb-6" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">{label}を読み込み中</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

// This module is also used by client forms; keep its header free of data fetching.
function Title({ title, action = false }: { title?: string; action?: boolean }) {
  return (
    <header data-glass-header className="sticky top-0 z-30 bg-bg/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:pt-0">
      <div className="flex h-12 items-center justify-between px-4 md:px-6 lg:h-16">
        {title ? <h1 className="min-w-0 truncate text-large-title">{title}</h1> : <Skeleton className="h-6 w-28" />}
        {action && <Skeleton className="ml-3 h-9 w-9 shrink-0 rounded-full" />}
      </div>
    </header>
  );
}

export function FormSkeleton() {
  return <LoadingRegion label="フォーム" className="py-2"><div className="space-y-5">{[0, 1, 2].map(i => <div key={i} className="space-y-2"><Skeleton className="h-3 w-24" /><Skeleton className={i === 2 ? "h-28 w-full rounded-xl" : "h-11 w-full rounded-xl lg:h-9"} /></div>)}</div></LoadingRegion>;
}

function Card({ lines = 2 }: { lines?: number }) {
  return (
    <Panel className="space-y-3 p-4">
      <div className="flex items-center gap-2.5">
        <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3.5 w-28 max-w-full" /><Skeleton className="h-2.5 w-20" /></div>
        <Skeleton className="h-4 w-4 shrink-0 rounded-full" />
      </div>
      <div className="space-y-2.5 py-1">{Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={`h-3 ${i === lines - 1 ? "w-2/3" : "w-full"}`} />)}</div>
      <div className="flex gap-5 pt-1"><Skeleton className="h-3.5 w-10" /><Skeleton className="h-3.5 w-10" /></div>
    </Panel>
  );
}

function Filters({ count = 3 }: { count?: number }) {
  return <div className="flex h-9 items-center gap-1 rounded-full bg-separator/50 p-1 lg:h-8">{Array.from({ length: count }, (_, i) => <div key={i} className={`flex h-full min-w-0 flex-1 items-center justify-center rounded-full px-2 ${i === 0 ? "bg-card shadow-sm" : ""}`}><Skeleton className="h-2.5 w-12 max-w-full rounded-full" /></div>)}</div>;
}

function ScheduleCard() {
  return (
    <Panel className="flex items-center gap-3 p-4 lg:gap-2.5 lg:p-3">
      <div className="flex w-12 shrink-0 flex-col items-center gap-1.5 lg:w-10"><Skeleton className="h-2.5 w-6" /><Skeleton className="h-6 w-7" /><Skeleton className="h-2 w-6" /></div>
      <div className="min-w-0 flex-1 space-y-2.5"><Skeleton className="h-3.5 w-3/4" /><Skeleton className="h-2.5 w-1/2" /><div className="flex gap-2"><Skeleton className="h-4 w-12 rounded-full" /><Skeleton className="h-4 w-16 rounded-full" /></div></div>
      <Skeleton className="h-3 w-3 shrink-0" />
    </Panel>
  );
}

function ProfileCard() {
  return <Panel className="flex items-center gap-4 p-4"><Skeleton className="h-16 w-16 shrink-0 rounded-full" /><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-5 w-32 max-w-full" /><Skeleton className="h-3 w-20" /><div className="flex gap-1.5"><Skeleton className="h-4 w-14 rounded-full" /><Skeleton className="h-4 w-12 rounded-full" /></div></div></Panel>;
}

export function TrainingChartSkeleton() {
  return <LoadingRegion label="練習量の推移" className=""><Panel className="h-[172px] space-y-3 p-4"><div className="flex items-center justify-between gap-3"><Skeleton className="h-3 w-24" /><div className="w-28"><Filters /></div></div><div className="flex h-[76px] items-end gap-2 border-b border-separator/70 px-1 pb-1">{[35, 52, 40, 68, 48, 72, 58, 82, 62, 90, 70, 55].map((height, i) => <Skeleton key={i} className="min-w-0 flex-1 rounded-t-sm rounded-b-none" style={{ height: `${height}%` }} />)}</div><div className="flex justify-between px-1"><Skeleton className="h-2 w-8" /><Skeleton className="h-2 w-8" /><Skeleton className="h-2 w-8" /></div></Panel></LoadingRegion>;
}

export function ActivitySkeleton() {
  return <LoadingRegion label="投稿" className=""><div className="space-y-3">{[0, 1, 2].map(i => <Card key={i} lines={i === 0 ? 3 : 2} />)}</div></LoadingRegion>;
}

export function HomeSkeleton({ withHeader = true }: { withHeader?: boolean } = {}) {
  return <LoadingRegion label="ホーム">
    {withHeader && <Title title="ホーム" action />}
    <div data-home-grid className="grid grid-cols-1 items-start gap-5 px-4 pt-1 md:px-6 lg:grid-cols-2 lg:gap-6">
      <Panel className="flex items-center gap-3 p-4 lg:col-span-2"><Skeleton className="h-5 w-5 shrink-0 rounded-full" /><Skeleton className="h-3 min-w-0 flex-1" /><Skeleton className="h-3 w-3 shrink-0" /></Panel>
      <section className="min-w-0 space-y-2 lg:col-span-2"><Label /><Panel className="space-y-3 p-4"><div className="flex items-center justify-between gap-4"><Skeleton className="h-4 w-40 max-w-full" /><Skeleton className="h-5 w-16 shrink-0 rounded-full" /></div><Skeleton className="h-2.5 w-28" /></Panel></section>
      <section className="min-w-0 space-y-2"><Label /><Panel className="space-y-4 p-4"><div className="flex justify-between gap-3"><Skeleton className="h-3.5 w-24" /><Skeleton className="h-3 w-16" /></div><Skeleton className="h-3 w-4/5" /><Skeleton className="h-3 w-3/5" /><div className="border-t border-separator/70 pt-3"><Skeleton className="h-3 w-1/2" /></div></Panel></section>
      <section className="min-w-0 space-y-2"><Label /><div className="grid grid-cols-2 gap-3">{[0, 1].map(i => <Panel key={i} className="space-y-3 p-4"><Skeleton className="h-2.5 w-16 max-w-full" /><Skeleton className="h-7 w-20 max-w-full" /><Skeleton className="h-2.5 w-12" /></Panel>)}</div></section>
      <section className="min-w-0 space-y-2"><Label /><ScheduleCard /><ScheduleCard /></section>
      <section className="min-w-0 space-y-2"><Label /><Rows count={2} /></section>
      <section className="min-w-0 space-y-2"><Label /><Card lines={2} /></section>
    </div>
  </LoadingRegion>;
}

export function ScheduleSkeleton({ withHeader = true }: { withHeader?: boolean } = {}) {
  return <LoadingRegion label="予定">{withHeader && <Title title="予定" action />}<div className="px-4 pb-3 pt-1 md:px-6 lg:pb-2"><div className="md:max-w-[520px]"><Filters count={4} /></div><div className="mt-2 md:max-w-[520px]"><Filters /></div></div><div data-schedule-grid className="px-4 pt-1 md:px-6 lg:grid lg:grid-cols-2 lg:gap-x-6"><Skeleton className="mb-2 h-[18px] w-20 lg:col-span-2" />{[0, 1, 2, 3].map(i => <div key={i} className="mb-3 min-w-0"><ScheduleCard /></div>)}</div></LoadingRegion>;
}


export function NotesSkeleton({ withHeader = true }: { withHeader?: boolean } = {}) {
  return <LoadingRegion label="ノート">{withHeader && <Title title="ノート" action />}<div className="space-y-4 px-4 pt-1 md:px-6 lg:space-y-3"><div className="md:max-w-[360px]"><Filters count={2} /></div><div className="flex h-11 items-center gap-2 rounded-xl border border-separator bg-card px-3 lg:h-9"><Skeleton className="h-4 w-4 shrink-0 rounded-full" /><Skeleton className="h-3 w-28" /></div><div className="grid gap-2 md:grid-cols-2 md:gap-3">{[0, 1, 2, 3].map(i => <Panel key={i} className="p-4"><div className="flex items-start gap-3"><Skeleton className="mt-0.5 h-5 w-5 shrink-0 rounded" /><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3.5 w-32 max-w-full" /><Skeleton className="h-2.5 w-16" />{i < 2 && <Skeleton className="h-2.5 w-4/5" />}</div><Skeleton className="h-4 w-4 shrink-0 rounded-full" /></div></Panel>)}</div></div></LoadingRegion>;
}
export function FeedSkeleton({ withHeader = true }: { withHeader?: boolean } = {}) {
  return <LoadingRegion label="タイムライン">
    {withHeader && <Title title="タイムライン" action />}
    <div className="w-full px-4 pb-3 pt-1 md:mx-auto md:max-w-[1120px] md:px-6 lg:pb-2"><div className="flex min-h-9 items-center gap-2 lg:min-h-8"><div className="min-w-0 flex-1 md:max-w-[420px]"><Filters count={4} /></div><Skeleton className="h-8 w-8 shrink-0 rounded-full" /><Skeleton className="h-8 w-8 shrink-0 rounded-full" /></div></div>
    <div className="w-full space-y-3 px-4 pt-1 md:mx-auto md:max-w-[1120px] md:px-6 lg:space-y-2">{[0, 1].map(i => <section key={i} className="space-y-1.5"><Skeleton className="ml-1 h-[18px] w-28" /><div className="space-y-3 lg:space-y-2"><Card lines={i === 0 ? 3 : 2} /><Card lines={2} /></div></section>)}</div>
  </LoadingRegion>;
}

export function PostDetailSkeleton({ withHeader = false }: { withHeader?: boolean }) {
  return <div className="space-y-4 pb-6">{withHeader && <Title />}<div className="px-4"><Card lines={3} /></div></div>;
}

export function NoticesSkeleton() {
  return <LoadingRegion label="お知らせ"><SubTitle title="お知らせ" /><div className="space-y-4"><div className="mt-2 px-4"><Filters count={2} /></div><div className="space-y-2 px-4"><Skeleton className="h-11 w-full rounded-xl lg:h-9" /><div className="flex min-h-7 items-center px-1"><Skeleton className="h-2.5 w-20" /></div></div><div className="space-y-3 px-4">{[0, 1, 2].map(i => <Card key={i} lines={i === 0 ? 3 : 2} />)}</div></div></LoadingRegion>;
}

export function ListSkeleton() {
  return <LoadingRegion label="一覧"><div className="space-y-4"><Title action /><div className="space-y-3 px-4"><Skeleton className="h-11 w-full rounded-xl lg:h-9" /><Skeleton className="h-3 w-16" /><Panel className="overflow-hidden">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="flex items-center gap-3 border-b border-separator px-4 py-3 last:border-0"><Skeleton className="h-9 w-9 shrink-0 rounded-full" /><div className="min-w-0 flex-1 space-y-2"><Skeleton className="h-3.5 w-28 max-w-full" /><Skeleton className="h-2.5 w-16" /></div><Skeleton className="h-3 w-3 shrink-0" /></div>)}</Panel></div></div></LoadingRegion>;
}

export function MyPageSkeleton() {
  return <LoadingRegion label="マイページ"><Title title="マイページ" action /><div className="space-y-5 px-4 pt-1"><ProfileCard /><TrainingChartSkeleton /><Panel className="divide-y divide-separator/70 overflow-hidden">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="flex items-center gap-3 p-4"><Skeleton className="h-5 w-5 shrink-0 rounded" /><Skeleton className="h-3.5 w-32 max-w-full" /><Skeleton className="ml-auto h-3 w-3 shrink-0" /></div>)}</Panel><section className="space-y-2"><Label /><Rows count={1} /></section><section className="space-y-2"><Label /><Card lines={2} /><Card lines={1} /></section></div></LoadingRegion>;
}

/** サブページ共通の見出し（左に戻る・中央にタイトル）。SubHeader と同じ高さ。 */
function SubTitle({ title }: { title?: string } = {}) {
  return <header data-glass-header className="sticky top-0 z-30 bg-bg/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:pt-0"><div data-new-ui-subheader-layout className="flex h-12 items-center gap-2 px-2 md:px-4 lg:h-16"><Skeleton className="h-5 w-11 shrink-0" /><div className="flex min-w-0 flex-1 justify-center">{title ? <h1 data-new-ui-title className="truncate text-center text-title">{title}</h1> : <Skeleton className="h-5 w-32 max-w-full" />}</div><div className="w-11 shrink-0" /></div></header>;
}

function Label() {
  return <Skeleton className="h-3 w-24" />;
}

/** カード1枚に区切り線で行を並べた形（一覧・設定系で共通） */
function Rows({ count, height = 56 }: { count: number; height?: number }) {
  return <Panel className="overflow-hidden">{Array.from({ length: count }).map((_, i) => <div key={i} className="flex items-center gap-3 border-b border-separator px-4 last:border-0" style={{ height }}><Skeleton className="h-3.5 min-w-0 flex-1 max-w-[60%]" /><Skeleton className="ml-auto h-3.5 w-12 shrink-0" /></div>)}</Panel>;
}

export function GoalsSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-5 px-4 pt-2">
    <section className="space-y-2"><Label /><div className="space-y-3 rounded-card border border-separator bg-card p-4"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /><Skeleton className="h-9 w-32 rounded-lg" /></div></section>
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
  return <div className="pb-6"><SubTitle /><div className="space-y-3 px-4 pt-2"><Skeleton className="h-3 w-32" /><Skeleton className="h-[60px] w-full rounded-card" />{[0, 1].map((i) => <section key={i} className="space-y-2"><Label /><Rows count={3} /></section>)}</div></div>;
}

export function CompetitionGoalsSkeleton() {
  // 自分の目標 → ブロック切替・検索 → 種目ごとの行（CompetitionGoalBoardと同じ並び）
  return <div className="pb-6"><SubTitle /><div className="space-y-4 px-4 pt-2"><section className="space-y-2"><Label /><Rows count={1} /></section><section className="space-y-3"><Label /><Skeleton className="h-9 w-full rounded-lg" /><Skeleton className="h-11 w-full rounded-xl" /><Rows count={5} /></section></div></div>;
}

export function ResultsSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="px-4 pt-2"><Rows count={6} /></div></div>;
}

export function CompetitionProgramSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-4 px-4 pt-2">{[0, 1].map((i) => <section key={i} className="space-y-2"><Label /><Rows count={3} /></section>)}</div></div>;
}

export function BlogListSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-4 px-4 pt-1 md:px-6"><div className="space-y-1.5"><Skeleton className="h-4 w-56" /><Skeleton className="h-2.5 w-32" /></div><div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="space-y-2 rounded-card border border-separator bg-card p-4"><Skeleton className="h-2.5 w-24" /><Skeleton className="h-4 w-4/5" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-1/2" /></div>)}</div></div></div>;
}

export function BlogArticleSkeleton() {
  return <div className="pb-8"><SubTitle /><div className="px-4 pt-1 md:px-6"><div className="rounded-card border border-separator bg-card px-4 py-5 sm:px-6"><div className="space-y-2 border-b border-separator pb-4"><Skeleton className="h-2.5 w-28" /><Skeleton className="h-5 w-3/4" /></div><div className="space-y-3 pt-4">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className={`h-3 ${i % 3 === 2 ? "w-2/3" : "w-full"}`} />)}</div></div></div></div>;
}

export function MemberSkeleton() {
  return <LoadingRegion label="部員のプロフィール"><SubTitle /><div className="space-y-5 px-4 pt-1"><ProfileCard /><TrainingChartSkeleton /><section className="space-y-2"><Label /><Rows count={2} /></section><section className="space-y-2"><Label /><Card lines={2} /></section></div></LoadingRegion>;
}

export function NoteFolderSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-4 px-4 pt-1"><Skeleton className="h-9 w-full rounded-lg" /><section className="space-y-2"><Label /><Rows count={2} /></section><section className="space-y-2"><Label /><Rows count={4} /></section></div></div>;
}

export function NoteArticleSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="px-4 pt-1"><div className="space-y-4 rounded-card border border-separator bg-card p-4"><Skeleton className="h-5 w-2/3" /><Skeleton className="h-2.5 w-32" />{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className={`h-3 ${i === 4 ? "w-1/2" : "w-full"}`} />)}</div></div></div>;
}

export function ThreadSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-4 px-4 pt-1"><Skeleton className="h-5 w-2/3" />{[0, 1, 2].map((i) => <Card key={i} lines={(i % 2) + 1} />)}<Skeleton className="h-24 w-full rounded-card" /></div></div>;
}

export function ServiceStatusSkeleton() {
  return <div className="pb-6"><SubTitle /><div className="space-y-3 px-4 pt-2">{[0, 1, 2].map((i) => <div key={i} className="space-y-3 rounded-card border border-separator bg-card p-4"><Skeleton className="h-3.5 w-32" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" /></div>)}</div></div>;
}
