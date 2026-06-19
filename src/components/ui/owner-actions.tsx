"use client";

import { Pencil, Trash2 } from "lucide-react";

export function OwnerActionMenu({
  onEdit,
  onDelete,
  deleting = false,
}: {
  onEdit: () => void;
  onDelete: () => void;
  deleting?: boolean;
}) {
  return (
    <div className="space-y-2 pb-4">
      <button
        type="button"
        onClick={onEdit}
        className="w-full flex items-center gap-3 rounded-xl bg-card border border-separator p-3.5 active:bg-bg"
      >
        <Pencil size={20} className="text-accent" />
        <span className="text-headline">編集する</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        className="w-full flex items-center gap-3 rounded-xl bg-card border border-separator p-3.5 active:bg-bg text-danger disabled:opacity-40"
      >
        <Trash2 size={20} />
        <span className="text-headline">{deleting ? "削除中…" : "削除する"}</span>
      </button>
    </div>
  );
}
