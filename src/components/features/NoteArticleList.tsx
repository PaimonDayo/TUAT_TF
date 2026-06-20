"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { ChevronDown, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Linkify } from "@/components/common/Linkify";
import { cn } from "@/lib/utils";
import type { NoteArticleWithAuthor } from "@/types";

/** 本文がこの長さを超えたら一覧では省略し「全文を表示」で記事詳細へ誘導する */
const LONG_BODY = 600;

/**
 * ノートフォルダ内の記事一覧。記事カードをタップすると、その場で本文を展開する
 * （別ページに飛ばない）。開閉でカードの左右位置・幅は変えない。
 */
export function NoteArticleList({
  noteId,
  articles,
}: {
  noteId: string;
  articles: NoteArticleWithAuthor[];
}) {
  // 1件のみ展開（初期は全件閉じる）
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {articles.map((article) => {
        const open = openId === article.id;
        const isLong = article.body.length > LONG_BODY;
        return (
          <Card key={article.id} className="p-4">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : article.id)}
              aria-expanded={open}
              className="flex w-full items-start gap-3 text-left"
            >
              <FileText size={19} className="mt-0.5 shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className={cn("text-headline", !open && "truncate")}>{article.title}</p>
                <p className="mt-1 text-caption">
                  {article.author.display_name}・
                  {format(new Date(article.updated_at), "M月d日更新", { locale: ja })}
                </p>
              </div>
              <ChevronDown
                size={18}
                className={cn(
                  "mt-0.5 shrink-0 text-muted transition-transform motion-reduce:transition-none",
                  open && "rotate-180",
                )}
              />
            </button>

            {open && (
              <div className="mt-3 border-t border-separator pt-3">
                <p className="whitespace-pre-wrap break-words text-[14px]">
                  <Linkify text={isLong ? article.body.slice(0, LONG_BODY) + "…" : article.body} />
                </p>
                {isLong && (
                  <Link
                    href={`/notes/${noteId}/articles/${article.id}`}
                    className="mt-2 inline-block text-[13px] font-medium text-accent active:opacity-60"
                  >
                    全文を表示
                  </Link>
                )}
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
