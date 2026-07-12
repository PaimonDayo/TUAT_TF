"use client";

import { useState } from "react";
import { FolderPlus } from "lucide-react";
import { NoteList } from "@/components/features/NotesView";
import { NoteComposer } from "@/components/features/NoteComposer";
import { Button } from "@/components/ui/button";
import { FormModal } from "@/components/ui/form-modal";
import type { AuthorMini, NoteScope, NoteWithRelations } from "@/types";

const MAX_DEPTH = 3;

/**
 * フォルダ詳細内のサブフォルダ一覧＋作成導線（タスク17-a）。
 * 追加ボタンはフォルダの管理者（作成者/管理者）だけに表示し、深さ3階層で打ち止め。
 * サブフォルダのscopeは親を引き継ぐ。
 */
export function SubfolderSection({
  parentId,
  parentScope,
  depth,
  children,
  currentUser,
  isAdmin,
  canManage,
}: {
  parentId: string;
  parentScope: NoteScope;
  /** このフォルダ自身の階層（ルート=1） */
  depth: number;
  children: NoteWithRelations[];
  currentUser: AuthorMini;
  isAdmin: boolean;
  canManage: boolean;
}) {
  const [composing, setComposing] = useState(false);
  const canAdd = canManage && depth < MAX_DEPTH;
  if (children.length === 0 && !canAdd) return null;

  return (
    <section className="space-y-2">
      <p className="section-label">サブフォルダ</p>
      {children.length > 0 && (
        <NoteList notes={children} currentUserId={currentUser.id} showAuthor={false} />
      )}
      {canAdd && (
        <Button
          type="button"
          variant="secondary"
          className="w-full border-dashed"
          onClick={() => setComposing(true)}
        >
          <FolderPlus size={17} />
          サブフォルダを追加
        </Button>
      )}
      {composing && (
        <FormModal open onOpenChange={setComposing} title="サブフォルダを作成">
          <NoteComposer
            currentUser={currentUser}
            isAdmin={isAdmin}
            initialScope={parentScope}
            parentId={parentId}
            onDone={() => setComposing(false)}
          />
        </FormModal>
      )}
    </section>
  );
}
