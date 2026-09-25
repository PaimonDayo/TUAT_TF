import { Wrench } from "lucide-react";
import { MAINTENANCE_WINDOW_LABEL } from "@/lib/maintenance";

export default function MaintenancePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center justify-center bg-bg px-6">
      <div className="w-full rounded-card border border-separator bg-card p-6 text-center">
        <Wrench className="mx-auto text-muted2" size={30} aria-hidden="true" />
        <h1 className="mt-3 text-title">ただいまメンテナンス中です</h1>
        <p className="mt-2 text-body text-muted2">
          サーバーの切替作業のため、下記の期間はご利用いただけません。
        </p>
        <p className="mt-3 text-headline">{MAINTENANCE_WINDOW_LABEL}</p>
        <p className="mt-4 text-body text-muted2">
          ご不便をおかけしますが、よろしくお願いいたします。
        </p>
      </div>
    </main>
  );
}
