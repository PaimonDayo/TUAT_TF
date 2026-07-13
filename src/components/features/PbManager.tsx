"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { FormModal } from "@/components/ui/form-modal";
import { useToast } from "@/components/ui/toast";
import { ResultsList } from "@/components/features/ResultsList";
import { ResultForm, type ResultFormHandle } from "@/components/post/ResultForm";
import { UnsavedChangesDialog } from "@/components/ui/unsaved-changes-dialog";
import type { PbRecord } from "@/types";

export function PbManager({
  userId,
  initial,
}: {
  userId: string;
  initial: PbRecord[];
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
        <ResultsList results={items} onEdit={openEdit} onDelete={remove} />

        <Button variant="outline" size="lg" onClick={openAdd} className="gap-2">
          <Plus size={18} /> 結果を追加
        </Button>
      </div>

      {open && (
        <FormModal
          open
          onOpenChange={(next) => { if (!next) { if (dirty) setConfirmClose(true); else setOpen(false); } }}
          title={editTarget ? "結果を編集" : "大会・記録会の結果を追加"}
        >
          <ResultForm
            ref={formRef}
            onDirtyChange={setDirty}
            key={editTarget?.id ?? "new"}
            userId={userId}
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
