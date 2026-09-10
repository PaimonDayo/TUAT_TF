import * as S from "@/components/ui/page-skeletons";

const ALL: [string, () => React.ReactNode][] = [
  ["Home", S.HomeSkeleton], ["Goals", S.GoalsSkeleton], ["PastGoals", S.PastGoalsSkeleton],
  ["Catalogue", S.CatalogueSkeleton], ["Competition", S.CompetitionSkeleton],
  ["CompetitionGoals", S.CompetitionGoalsSkeleton], ["Results", S.ResultsSkeleton],
  ["BlogList", S.BlogListSkeleton], ["BlogArticle", S.BlogArticleSkeleton],
  ["Member", S.MemberSkeleton], ["NoteFolder", S.NoteFolderSkeleton],
  ["NoteArticle", S.NoteArticleSkeleton], ["Thread", S.ThreadSkeleton],
  ["ServiceStatus", S.ServiceStatusSkeleton],
];

export default function Page() {
  return <div className="bg-bg">{ALL.map(([name, C]) => (
    <div key={name} className="mb-6">
      <p className="bg-black px-2 py-1 text-xs text-white">{name}</p>
      <div className="mx-auto w-[390px] border border-red-400">{C()}</div>
    </div>
  ))}</div>;
}
