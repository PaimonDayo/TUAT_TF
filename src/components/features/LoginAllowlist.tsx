"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { allowedEmailError, normalizeAllowedEmail, type LoginAllowedEmail } from "@/lib/login-allowlist";
import { ActionMenu } from "@/components/ui/action-menu";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FormDraftGuard, FormModal } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export function LoginAllowlist({ entries }: { entries: LoginAllowedEmail[] }) {
  const [items, setItems] = useState(entries);
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const unresolved = useRef<{ action: "add" | "remove"; email: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();

  async function reload() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/login-allowlist", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.entries)) throw new Error();
      setItems(result.entries);
      const previous = unresolved.current;
      if (previous) {
        const exists = result.entries.some((item: LoginAllowedEmail) => item.email === previous.email);
        if (previous.action === "add" && exists) {
          setEmail(""); setEditing(false); showToast("メールの登録を確認しました");
        } else if (previous.action === "remove" && !exists) {
          showToast("ログインの許可の取り消しを確認しました");
        }
      }
      unresolved.current = null;
      setUncertain(false);
      setError(null);
    } catch {
      setError("許可リストを取得できませんでした。接続を確認して再読み込みしてください。");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function change(action: "add" | "remove", value: string): Promise<boolean> {
    if (pending.current || uncertain) return false;
    const normalized = normalizeAllowedEmail(value);
    if (action === "add") {
      const validation = allowedEmailError(normalized);
      if (validation) { setError(validation); return false; }
      if (items.some((item) => item.email === normalized)) { setError("このメールアドレスは登録済みです"); return false; }
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login-allowlist", {
        method: action === "add" ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: normalized }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.uncertain || response.status >= 500 && !result.unchanged) throw new Error();
        setError(typeof result.error === "string" ? result.error : "変更できませんでした。管理権限を確認してください。");
        return false;
      }
      const entry = result.entry as LoginAllowedEmail | undefined;
      if (!entry || entry.email !== normalized) throw new Error();
      setItems((current) => action === "add"
        ? [...current.filter((item) => item.email !== normalized), entry].sort((a, b) => a.email.localeCompare(b.email))
        : current.filter((item) => item.email !== normalized));
      if (action === "add") { setEmail(""); setEditing(false); }
      showToast(action === "add" ? "ログインを許可しました" : "ログインの許可を取り消しました");
      return true;
    } catch {
      unresolved.current = { action, email: normalized };
      setUncertain(true);
      setError("変更結果を確認できませんでした。再読み込みして登録状況を確認してください。");
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <div className="space-y-3">
    <p className="text-caption">登録しても管理権限は付きません。ログインや許可の取り消しに数分かかる場合があります。</p>
    <div className="flex justify-end gap-2">
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void reload()}>再読み込み</Button>
      <Button type="button" size="sm" disabled={busy || uncertain} onClick={() => { setError(null); setEditing(true); }}><Plus size={16} />メールを追加</Button>
    </div>
    {error && !editing && <p role="alert" className="text-caption text-danger">{error}</p>}
    {items.length ? <Card className="divide-y divide-separator">
      {items.map((item) => <div key={item.email} className="flex items-center gap-2 px-3 py-2">
        <span className="min-w-0 flex-1 break-all text-sm">{item.email}</span>
        {!busy && !uncertain && <ActionMenu triggerLabel={`${item.email}の操作メニュー`} onDelete={() => change("remove", item.email)}
          deleteLabel="ログインの許可を取り消す" deleteTitle="ログインの許可を取り消しますか？"
          deleteDescription={`${item.email}の利用を停止します。投稿や記録は残ります。許可の取り消しに数分かかる場合があります。`} />}
      </div>)}
    </Card> : <p className="text-caption">個人アカウントの登録はまだありません。</p>}
    <FormModal open={editing} onOpenChange={(open) => { if (!busy) setEditing(open); }} title="ログインを許可するメール"
      footer={<Button type="submit" form="login-allowed-email" disabled={busy || uncertain || !email.trim()}>{busy ? "追加中…" : "追加する"}</Button>}>
      <form id="login-allowed-email" className="space-y-4 p-4" onSubmit={(event) => { event.preventDefault(); void change("add", email); }}>
        <FormDraftGuard dirty={!!email.trim()} busy={busy} onSave={() => change("add", email).then(() => {})} />
        <label className="block space-y-2"><span className="text-sm font-semibold">Googleアカウントのメールアドレス</span>
          <Input type="email" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={254}
            placeholder="例: member@gmail.com" value={email} disabled={busy || uncertain} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <p className="text-caption">本人がGoogleへのログインに使うメールアドレスを入力してください。</p>
        {error && <p role="alert" className="text-caption text-danger">{error}</p>}
        {uncertain && <Button type="button" variant="outline" disabled={busy} onClick={() => void reload()}>許可リストを再読み込み</Button>}
      </form>
    </FormModal>
  </div>;
}
