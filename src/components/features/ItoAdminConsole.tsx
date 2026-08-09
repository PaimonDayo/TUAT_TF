"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { FormModal, FormModalFooter } from "@/components/ui/form-modal";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  ITO_GAME_NAME_MAX,
  itoCapacityWarning,
  itoEntryCounts,
  validateItoGameForm,
  type ItoGameFormValues,
} from "@/lib/ito-entry";
import { ITO_GAME_STATUS_LABELS } from "@/lib/ito-phase";
import {
  closeItoEntry,
  createItoGame,
  deleteItoGame,
  finishItoGame,
  openItoEntry,
  updateItoGame,
} from "@/app/(app)/ito/actions";
import type { AppRole, ItoGame, ItoInvitation } from "@/types";

/**
 * ito の進行コンソール。この画面はシステム管理者だけが開ける
 * （ページ側でも権限を確認し、DB 側は RLS が最終判定）。
 */
export function ItoAdminConsole({
  games,
  roles,
  invitations,
  memberNames,
  targetCounts,
}: {
  games: ItoGame[];
  roles: AppRole[];
  invitations: Record<string, ItoInvitation[]>;
  memberNames: Record<string, string>;
  /** ロールごとの招待対象人数（進行役を除く） */
  targetCounts: Record<string, number>;
}) {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ItoGame | null>(null);

  return (
    <>
      <section className="space-y-2">
        <p className="section-label">ゲーム</p>
        <p className="text-caption">
          ゲームの作成と進行はシステム管理者だけが行えます。進行役はゲームに参加しないため、
          システム管理権限を持つ人は招待対象から外れます。
        </p>

        {games.length === 0 ? (
          <EmptyState
            title="まだゲームはありません"
            description="ゲームを作成すると、対象ロールの部員へ参加確認を送れます。"
          />
        ) : (
          <div className="space-y-3">
            {games.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                roleName={roles.find((role) => role.id === game.target_role_id)?.name ?? "未設定"}
                invitations={invitations[game.id] ?? []}
                memberNames={memberNames}
                onEdit={() => setEditing(game)}
              />
            ))}
          </div>
        )}

        <Button variant="outline" size="lg" onClick={() => setCreating(true)} className="gap-2">
          <Plus size={18} /> ゲームを作成
        </Button>
      </section>

      {creating && (
        <FormModal open onOpenChange={setCreating} title="ゲームを作成">
          <GameForm
            roles={roles}
            targetCounts={targetCounts}
            onSaved={() => setCreating(false)}
          />
        </FormModal>
      )}

      {editing && (
        <FormModal
          open
          onOpenChange={(open) => !open && setEditing(null)}
          title="ゲームを編集"
        >
          <GameForm
            game={editing}
            roles={roles}
            targetCounts={targetCounts}
            onSaved={() => setEditing(null)}
          />
        </FormModal>
      )}
    </>
  );
}

function GameCard({
  game,
  roleName,
  invitations,
  memberNames,
  onEdit,
}: {
  game: ItoGame;
  roleName: string;
  invitations: ItoInvitation[];
  memberNames: Record<string, string>;
  onEdit: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<null | "close" | "finish" | "delete">(null);
  const counts = itoEntryCounts(invitations);
  const warning =
    game.status === "entry" || game.status === "active"
      ? itoCapacityWarning({
          joined: counts.joined,
          groupCount: game.group_count,
          maxGroupSize: game.max_group_size,
        })
      : null;

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await action();
      showToast(done);
      setConfirming(null);
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "実行できませんでした");
    } finally {
      setBusy(false);
    }
  }

  const pendingNames = invitations
    .filter((invitation) => invitation.status === "pending")
    .map((invitation) => memberNames[invitation.profile_id] ?? "退部者")
    .slice(0, 12);

  return (
    <Card className="p-3 space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-headline break-words">{game.name}</p>
          <p className="text-caption">
            対象: {roleName} ／ {game.group_count}グループ × 最大{game.max_group_size}人
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">
          {ITO_GAME_STATUS_LABELS[game.status]}
        </span>
      </div>

      {game.status !== "draft" && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat label="対象" value={counts.target} />
          <Stat label="参加" value={counts.joined} tone="text-success" />
          <Stat label="不参加" value={counts.declined} tone="text-danger" />
          <Stat label="未回答" value={counts.pending} tone="text-warning" />
        </div>
      )}

      {warning && <p className="text-caption text-warning">{warning}</p>}

      {game.status === "entry" && pendingNames.length > 0 && (
        <p className="text-caption">
          <Users size={12} className="mr-1 inline" />
          未回答: {pendingNames.join("、")}
          {counts.pending > pendingNames.length && ` ほか${counts.pending - pendingNames.length}人`}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {game.status === "draft" && (
          <>
            <Button size="sm" disabled={busy} onClick={() => void run(() => openItoEntry(game.id), "エントリーを開始しました")} className="gap-1">
              <Send size={15} /> エントリーを開始する
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>
              設定を変更
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming("delete")}>
              削除
            </Button>
          </>
        )}
        {game.status === "entry" && (
          <Button size="sm" disabled={busy} onClick={() => setConfirming("close")}>
            エントリー受付を終了する
          </Button>
        )}
        {game.status === "active" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirming("finish")}>
            ゲームを終了する
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirming === "close"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="エントリー受付を終了しますか？"
        description={`この操作は元に戻せません。未回答の${counts.pending}人は、このゲームの参加者に含まれません（あとから改めて招待できます）。`}
        confirmLabel="受付を終了する"
        busyLabel="終了中…"
        busy={busy}
        onConfirm={() => void run(() => closeItoEntry(game.id), "エントリー受付を終了しました")}
      />
      <ConfirmDialog
        open={confirming === "finish"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="ゲームを終了しますか？"
        description="この操作は元に戻せません。以降は結果の閲覧だけになります。"
        confirmLabel="終了する"
        busyLabel="終了中…"
        busy={busy}
        onConfirm={() => void run(() => finishItoGame(game.id), "ゲームを終了しました")}
      />
      <ConfirmDialog
        open={confirming === "delete"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={`「${game.name}」を削除しますか？`}
        description="この操作は元に戻せません。エントリー開始前のゲームだけ削除できます。"
        busy={busy}
        onConfirm={() => void run(() => deleteItoGame(game.id), "ゲームを削除しました")}
      />
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl bg-bg/60 py-2">
      <p className={`text-[17px] font-bold tabular-nums ${tone ?? ""}`}>{value}</p>
      <p className="text-micro text-muted2">{label}</p>
    </div>
  );
}

function GameForm({
  game,
  roles,
  targetCounts,
  onSaved,
}: {
  game?: ItoGame;
  roles: AppRole[];
  targetCounts: Record<string, number>;
  onSaved: () => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [name, setName] = useState(game?.name ?? "");
  const [targetRoleId, setTargetRoleId] = useState(game?.target_role_id ?? "");
  const [groupCount, setGroupCount] = useState(String(game?.group_count ?? 10));
  const [maxGroupSize, setMaxGroupSize] = useState(String(game?.max_group_size ?? 5));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const values: ItoGameFormValues = {
    name,
    targetRoleId: targetRoleId || null,
    groupCount: Number(groupCount),
    maxGroupSize: Number(maxGroupSize),
  };
  const targetCount = targetRoleId ? (targetCounts[targetRoleId] ?? 0) : 0;
  const capacity = (Number(groupCount) || 0) * (Number(maxGroupSize) || 0);

  async function submit() {
    const errors = validateItoGameForm(values);
    if (errors.length > 0) {
      setError(errors[0].message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (game) await updateItoGame(game.id, values);
      else await createItoGame(values);
      showToast(game ? "ゲームを更新しました" : "ゲームを作成しました");
      onSaved();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存できませんでした");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 pb-4">
      <div>
        <p className="section-label mb-1.5">ゲーム名</p>
        <Input
          placeholder="例: 合宿2026 ito"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={ITO_GAME_NAME_MAX}
        />
      </div>
      <div>
        <p className="section-label mb-1.5">参加対象のロール</p>
        <Select
          value={targetRoleId}
          onValueChange={setTargetRoleId}
          ariaLabel="参加対象のロール"
          options={roles.map((role) => ({
            value: role.id,
            label: `${role.name}（${targetCounts[role.id] ?? 0}人）`,
          }))}
        />
        {targetRoleId && (
          <p className="text-caption mt-1">
            招待対象は{targetCount}人です（システム管理者を除く）。
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="section-label mb-1.5">グループ数</p>
          <Input
            value={groupCount}
            onChange={(event) => setGroupCount(event.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            maxLength={2}
          />
        </div>
        <div>
          <p className="section-label mb-1.5">1グループの最大人数</p>
          <Input
            value={maxGroupSize}
            onChange={(event) => setMaxGroupSize(event.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            maxLength={2}
          />
        </div>
      </div>
      <p className="text-caption">
        収容できるのは最大{capacity}人です。各グループは代表者1人と回答する人が1人以上必要なため、
        2人以上になるように編成します。
      </p>

      {error && <p className="text-caption text-danger text-center">{error}</p>}

      <FormModalFooter>
        <Button size="lg" onClick={submit} disabled={saving} className="gap-1">
          {saving ? "保存中…" : game ? "更新する" : "作成する"}
        </Button>
      </FormModalFooter>
    </div>
  );
}
