"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FormModal } from "@/components/ui/form-modal";
import { useToast } from "@/components/ui/toast";
import { ResultsList } from "@/components/features/ResultsList";
import { ResultForm, type ResultFormHandle } from "@/components/post/ResultForm";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import type { CompetitionEvent } from "@/lib/competition-goals";
import type { CompetitionRow, PbRecord } from "@/types";

export function PbManager({
  userId,
  initial,
  events,
  competitions,
  addLabel = "結果を追加",
}: {
  /** 結果の持ち主。システム管理者が他の部員の結果を直すときは本人以外になる */
  userId: string;
  initial: PbRecord[];
  events: CompetitionEvent[];
  competitions: CompetitionRow[];
  addLabel?: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [items, setItems] = useState<PbRecord[]>(initial);
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PbRecord | null>(null);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const formRef = useRef<ResultFormHandle>(null);

  function openAdd() {
    setEditTarget(null);
    setOpen(true);
  }
  function openEdit(pb: PbRecord) {
    setEditTarget(pb);
    setOpen(true);
  }

  async function remove(id: string) {
    const previous = items;
    setItems((arr) => arr.filter((x) => x.id !== id));
    const supabase = createClient();
    const { error } = await supabase.from("pb_records").delete().eq("id", id);
    if (error) {
      setItems(previous);
      showToast("結果を削除できませんでした");
      return false;
    }
    router.refresh();
    return true;
  }

  return (
    <>
      <div className="space-y-3">
        <ResultsList results={items} events={events} onEdit={openEdit} onDelete={remove} />
      </div>

      {/* 追加は他の画面と同じくFABから。一覧の下にボタンを置かない（規約: 書く=FAB） */}
      <button
        type="button"
        onClick={openAdd}
        aria-label={addLabel}
        className="fixed bottom-24 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-xl pressable"
      >
        <Plus size={26} />
      </button>

      {open && (
        <FormModal
          open
          onOpenChange={(next) => { if (!next) { if (dirty) setConfirmClose(true); else setOpen(false); } }}
          title={editTarget ? "大会・記録会の結果を編集" : "大会・記録会の結果"}
        >
          <ResultForm
            ref={formRef}
            onDirtyChange={setDirty}
            key={editTarget?.id ?? "new"}
            userId={userId}
            events={events}
            competitions={competitions}
            initial={editTarget ?? undefined}
            onDone={(saved) => {
              if (saved) {
                setItems((arr) =>
                  editTarget
                    ? arr.map((x) => (x.id === saved.id ? saved : x))
                    : [saved, ...arr],
                );
              }
              setDirty(false);
              setOpen(false);
            }}
          />
        </FormModal>
      )}
      <UnsavedChangesDialog open={confirmClose} busy={false} onContinue={() => setConfirmClose(false)} onDiscard={() => { setDirty(false); setConfirmClose(false); setOpen(false); }} onSave={() => { setConfirmClose(false); formRef.current?.save(); }} />
    </>
  );
}
