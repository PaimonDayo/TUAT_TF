"use client";

/* eslint-disable @next/next/no-img-element */

import { useRef } from "react";
import { X } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  insertPhotoAt,
  removePhotoBlock,
  type NoteBlock,
} from "@/lib/note-body";

export type EditorPhoto = {
  /** 本文の目印に使うキー（保存済みの写真も、これから保存する写真も同じ形） */
  key: string;
  /** 表示用のURL。保存済みは配信API、これからの分はプレビュー */
  src: string;
  pending: boolean;
};

/**
 * 本文の編集。文章の間に写真をそのまま挟んで見せ、書きながら位置を決められるようにする。
 * 入力欄は素の textarea のままにして、iOSでの入力の確実さを崩さない。
 */
export function NoteBodyEditor({
  blocks,
  photos,
  disabled = false,
  onChange,
  onCaretChange,
}: {
  blocks: NoteBlock[];
  photos: EditorPhoto[];
  disabled?: boolean;
  onChange: (blocks: NoteBlock[]) => void;
  /** 「本文に入れる」の差し込み先を覚えておくため、最後に触った文章と位置を伝える */
  onCaretChange: (position: { textIndex: number; caret: number }) => void;
}) {
  const photoByKey = new Map(photos.map((photo) => [photo.key, photo]));
  const lastText = useRef<{ textIndex: number; caret: number }>({
    textIndex: 0,
    caret: 0,
  });

  function report(textIndex: number, caret: number) {
    lastText.current = { textIndex, caret };
    onCaretChange(lastText.current);
  }

  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        if (block.type === "text") {
          const first = index === 0;
          return (
            <Textarea
              key={`text-${index}`}
              autoGrow
              rows={first ? 6 : 2}
              className={first ? "min-h-32" : "min-h-16"}
              disabled={disabled}
              value={block.text}
              placeholder={first ? "残しておきたい知識や考えを入力" : "写真の説明などを入力"}
              onChange={(event) => {
                const next = [...blocks];
                next[index] = { type: "text", text: event.target.value };
                onChange(next);
                report(index, event.target.selectionStart ?? event.target.value.length);
              }}
              onSelect={(event) =>
                report(index, event.currentTarget.selectionStart ?? 0)
              }
              onFocus={(event) =>
                report(index, event.currentTarget.selectionStart ?? 0)
              }
            />
          );
        }

        const photo = photoByKey.get(block.key);
        if (!photo) return null;
        return (
          <figure key={`photo-${block.key}`} className="relative">
            <img
              src={photo.src}
              alt="本文に入れた写真"
              className="w-full rounded-xl object-contain"
            />
            {photo.pending && (
              <span className="absolute inset-x-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-center text-[10px] text-white">
                保存時に追加
              </span>
            )}
            <button
              type="button"
              aria-label="この写真を本文から外す"
              disabled={disabled}
              onClick={() => onChange(removePhotoBlock(blocks, block.key))}
              className="absolute right-2 top-2 rounded-full bg-black/65 p-1.5 text-white active:opacity-70"
            >
              <X size={14} />
            </button>
          </figure>
        );
      })}
    </div>
  );
}

/** 「本文に入れる」の実処理。最後に触っていた文章の位置へ差し込む。 */
export function insertPhotoIntoBody(
  blocks: NoteBlock[],
  position: { textIndex: number; caret: number },
  key: string,
): NoteBlock[] {
  return insertPhotoAt(blocks, position.textIndex, position.caret, key);
}
