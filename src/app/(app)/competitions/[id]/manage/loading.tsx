import { SubHeader } from "@/components/layout/SubHeader";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() { return <><SubHeader title="大会の運営" backHref="/competitions"/><div className="space-y-3 px-4 py-4"><Skeleton className="h-12 w-full"/><Skeleton className="h-16 w-full"/><Skeleton className="h-16 w-full"/></div></>; }
