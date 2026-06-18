"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { ResultsList } from "@/components/features/ResultsList";
import { ResultForm } from "@/components/post/ResultForm";
import type { PbRecord } from "@/types";

export function PbManager({
  userId,
  initial,
}: {
  userId: string;
  initial: PbRecord[];
}) {
  const router = useRouter();
  const [items, setItems] = useState<PbRecord[]>(initial);
  const [open, setOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<PbRecord | null>(null);

  function openAdd() {
    setEditTarget(null);
    setOpen(true);
  }
  function openEdit(pb: PbRecord) {
    setEditTarget(pb);
    setOpen(true);
  }

  async function remove(id: string) {
    setItems((arr) => arr.filter((x) => x.id !== id));
    const supabase = createClient();
    await supabase.from("pb_records").delete().eq("id", id);
    router.refresh();
  }

  return (
    <>
      <div className="space-y-3">
        <ResultsList results={items} onEdit={openEdit} onDelete={remove} />

        <Button variant="outline" size="lg" onClick={openAdd} className="gap-2">
          <Plus size={18} /> 結果を追加
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent title={editTarget ? "結果を編集" : "大会・記録会の結果を追加"}>
          <ResultForm
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
              setOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
