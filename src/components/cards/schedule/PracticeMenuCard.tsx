import { useState } from "react";
import { ListChecks, Timer, StickyNote, Dumbbell } from "lucide-react";
import { ActionMenu } from "@/components/ui/action-menu";
import { useToast } from "@/components/ui/toast";
import { Linkify } from "@/components/common/Linkify";
import { MenuEditModal, SheetMenuEditModal } from "@/components/post/MenuForm";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Block, PracticeMenu } from "@/types";

export function MenuCard({
  canDelete,
  editableBlocks,
  restrictBlock,
  menu,
  scheduleId,
  canManage,
  isTargeted = false,
  isMyBlock = false,
  onChanged,
}: {
  menu: PracticeMenu;
  scheduleId: string;
  canManage: boolean;
  canDelete: boolean;
  editableBlocks: Block[];
  restrictBlock: boolean;
  isTargeted?: boolean;
  isMyBlock?: boolean;
  onChanged: (menu: PracticeMenu | null) => void;
}) {
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const targetNames =
    menu.targets?.map((target) => target.profile?.display_name).filter(Boolean) ?? [];

  const [publishing, setPublishing] = useState(false);

  if (menu.source === "sheet") {
    return <SheetMenuCard menu={menu} scheduleId={scheduleId} canManage={canManage} onChanged={onChanged} />;
  }

  async function remove() {
    const supabase = createClient();
    const { data, error } = await supabase.from("practice_menus").delete().eq("id", menu.id).select("id");
    if (error || !data?.length) {
      showToast("練習メニューを削除できませんでした");
      return false;
    }
    onChanged(null);
    return true;
  }

  async function publish() {
    setPublishing(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("practice_menus")
      .update({ status: "published" })
      .eq("id", menu.id)
      .select("id");
    if (error || !data || data.length === 0) {
      setPublishing(false);
      showToast("公開できませんでした");
      return;
    }
    showToast("メニューを公開しました");
    onChanged({ ...menu, status: "published" });
  }

  const hasBadges = menu.status === "draft" || targetNames.length > 0;

  return (
    <div
      className={cn(
        "relative rounded-xl border p-3",
        isTargeted
          ? "border-accent/45 bg-accent/5" // 自分が対象の個別メニュー＝青系
          : isMyBlock
            ? "border-[#34c759]/45 bg-[#34c759]/8" // 自分の所属ブロック＝緑系
            : "border-transparent bg-bg",
      )}
    >
      {/* 操作メニューは右上に絶対配置（空のヘッダー行で余白が出ないように） */}
      {canManage && (
        <div className="absolute right-1.5 top-1.5">
          <ActionMenu
            onEdit={() => setEditing(true)}
            onDelete={canDelete ? remove : undefined}
            deleteTitle="練習メニューを削除しますか？"
            deleteDescription="削除したメニューは元に戻せません。"
            triggerLabel="練習メニューの操作"
          />
        </div>
      )}
      {hasBadges && (
        <div className={cn("mb-1 flex flex-wrap items-center gap-1.5", canManage && "pr-8")}>
          {menu.status === "draft" && (
            <span className="rounded border border-warning px-1.5 py-0.5 text-[10px] font-bold text-warning">
              下書き
            </span>
          )}
          {targetNames.length > 0 && (
            <span className="text-[11px] text-muted2">
              対象: {targetNames.join("、")}
            </span>
          )}
        </div>
      )}
      {menu.content && (
        <p className={cn("text-[14px] whitespace-pre-wrap", canManage && !hasBadges && "pr-8")}>
          <Linkify text={menu.content} />
        </p>
      )}
      {menu.pace && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-muted2">ペース</p>
          <p className="text-[14px] whitespace-pre-wrap">
            <Linkify text={menu.pace} />
          </p>
        </div>
      )}
      {menu.remark && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-muted2">
            {menu.target_block === "short" ? "説明" : "補足"}
          </p>
          <p className="text-[14px] whitespace-pre-wrap">
            <Linkify text={menu.remark} />
          </p>
        </div>
      )}
      {menu.supplement && (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-muted2">補強</p>
          <p className="text-[14px] whitespace-pre-wrap">
            <Linkify text={menu.supplement} />
          </p>
        </div>
      )}
      {canManage && menu.status === "draft" && (
        <button
          type="button"
          data-ui-action="text" data-ui-tone="primary" onClick={publish}
          disabled={publishing}
          className="mt-2 inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-white pressable disabled:opacity-50"
        >
          {publishing ? "公開中…" : "公開する"}
        </button>
      )}
      <MenuEditModal
        allowedBlocks={restrictBlock ? editableBlocks : undefined}
        menu={menu}
        scheduleId={scheduleId}
        open={editing}
        onOpenChange={setEditing}
        onSaved={(saved) => onChanged(saved)}
      />
    </div>
  );
}

function SheetMenuCard({
  menu,
  scheduleId,
  canManage,
  onChanged,
}: {
  menu: PracticeMenu;
  scheduleId: string;
  canManage: boolean;
  onChanged: (menu: PracticeMenu | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="relative space-y-2">
      <p className={cn("text-[10px] font-semibold text-muted2", canManage && "pr-8")}>
        スプレッドシートから最新表示
      </p>
      {canManage && (
        <div className="absolute -right-1.5 -top-1.5">
          <ActionMenu
            onEdit={() => setEditing(true)}
            triggerLabel="中長距離メニューの操作"
          />
        </div>
      )}
      {menu.content && (
        <SheetMenuSection
          icon={<ListChecks size={14} />}
          label="練習メニュー"
          text={menu.content}
          className="border-blue-200/70 bg-blue-50/70 text-blue-700"
        />
      )}
      {menu.pace && (
        <SheetMenuSection
          icon={<Timer size={14} />}
          label="ペース目安"
          text={menu.pace}
          className="border-emerald-200/70 bg-emerald-50/70 text-emerald-700"
        />
      )}
      {menu.remark && (
        <SheetMenuSection
          icon={<StickyNote size={14} />}
          label="補足・メモ"
          text={menu.remark}
          className="border-amber-200/70 bg-amber-50/70 text-amber-700"
        />
      )}
      {menu.supplement && (
        <SheetMenuSection
          icon={<Dumbbell size={14} />}
          label="補強"
          text={menu.supplement}
          className="border-violet-200/70 bg-violet-50/70 text-violet-700"
        />
      )}
      {editing && (
        <SheetMenuEditModal
          menu={menu}
          scheduleId={scheduleId}
          onOpenChange={setEditing}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}
function SheetMenuSection({
  icon,
  label,
  text,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  text: string;
  className: string;
}) {
  return (
    <div className={cn("rounded-xl border p-3", className)}>
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold">
        {icon}
        {label}
      </p>
      <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">
        <Linkify text={text} />
      </p>
    </div>
  );
}
