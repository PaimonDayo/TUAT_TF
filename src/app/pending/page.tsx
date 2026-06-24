import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PendingSignOut } from "./sign-out-button";

/**
 * 承認待ち画面。
 * 認証は済んでいるが、管理者にまだ利用承認されていないユーザー向け。
 * - 未ログイン → /login
 * - 承認済み   → /home（この画面に留まらせない）
 * - 未承認     → 承認待ちメッセージを表示
 */
export default async function PendingPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) redirect("/login");

  // 自分のプロフィール行は承認前でも読める（RLS の自己例外）。
  const { data: profile } = await supabase
    .from("profiles")
    .select("approved")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.approved) redirect("/home");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-8 text-center">
      <div className="space-y-3">
        <h1 className="text-headline">承認待ちです</h1>
        <p className="text-caption leading-relaxed text-muted">
          アカウントの作成が完了しました。
          <br />
          部の管理者が利用を承認すると、アプリを使えるようになります。
          <br />
          承認までしばらくお待ちください。
        </p>
      </div>
      <PendingSignOut />
    </main>
  );
}
