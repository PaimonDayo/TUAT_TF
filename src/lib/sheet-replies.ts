export type RawSheetReply = {
  replyIndex: number;
  content: string;
  source: "app" | "sheet";
};

export type ImportedSheetReply = {
  replyIndex: number;
  content: string;
};

export function normalizeSheetReplyText(value: string): string {
  return value.replace(/[\s\u3000]+/g, " ").trim();
}

/**
 * アプリ返信のスプレッドシート写しを表示・取込対象から外す。
 * 新しい返信は列位置、旧返信は「本文＋投稿者名」の正規化文字列で照合する。
 */
export function sheetRepliesWithoutAppDuplicates<
  T extends { replyIndex: number; content: string },
>(
  replies: T[],
  exportedAppReplies: Iterable<string>,
  exportedAppReplyIndexes: Iterable<number> = [],
): T[] {
  const exportedTexts = new Set(
    Array.from(exportedAppReplies, normalizeSheetReplyText).filter(Boolean),
  );
  const exportedIndexes = new Set(
    Array.from(exportedAppReplyIndexes).filter(
      (index) => Number.isInteger(index) && index >= 0,
    ),
  );

  return replies.filter(
    (reply) =>
      !exportedIndexes.has(reply.replyIndex) &&
      !exportedTexts.has(normalizeSheetReplyText(reply.content)),
  );
}

export function importedSheetReplies(
  replies: RawSheetReply[],
  exportedAppReplies: Iterable<string>,
  exportedAppReplyIndexes: Iterable<number> = [],
): ImportedSheetReply[] {
  const byIndex = new Map<number, ImportedSheetReply>();

  for (const reply of replies) {
    const content = reply.content.trim();
    if (
      reply.source !== "sheet" ||
      !Number.isInteger(reply.replyIndex) ||
      reply.replyIndex < 0 ||
      !content ||
      content.length > 2000
    ) {
      continue;
    }
    byIndex.set(reply.replyIndex, { replyIndex: reply.replyIndex, content });
  }

  return sheetRepliesWithoutAppDuplicates(
    [...byIndex.values()].sort((a, b) => a.replyIndex - b.replyIndex),
    exportedAppReplies,
    exportedAppReplyIndexes,
  );
}

export type AppReplyIndexCandidate = {
  id: string;
  content: string;
  authorName: string;
  createdAt: string;
  sheetReplyIndex: number | null;
};

export type AppReplyIndexMatch = {
  commentId: string;
  replyIndex: number;
};

/** 公開CSVの返信セルとアプリ返信を本文＋投稿者名で照合し、左からの列位置を復元する。 */
export function matchAppReplyIndexes(
  replies: RawSheetReply[],
  comments: AppReplyIndexCandidate[],
): AppReplyIndexMatch[] {
  const commentsByText = new Map<string, AppReplyIndexCandidate[]>();
  for (const comment of [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const exportedText = normalizeSheetReplyText(
      comment.authorName ? `${comment.content}　${comment.authorName}` : comment.content,
    );
    if (!exportedText) continue;
    const queue = commentsByText.get(exportedText) ?? [];
    queue.push(comment);
    commentsByText.set(exportedText, queue);
  }

  const matches: AppReplyIndexMatch[] = [];
  for (const reply of [...replies].sort((a, b) => a.replyIndex - b.replyIndex)) {
    const queue = commentsByText.get(normalizeSheetReplyText(reply.content));
    const comment = queue?.shift();
    if (!comment || comment.sheetReplyIndex === reply.replyIndex) continue;
    matches.push({ commentId: comment.id, replyIndex: reply.replyIndex });
  }
  return matches;
}

export type ReplyOrderInput = {
  id: string;
  /** アプリ返信の投稿時刻。スプレッドシートにだけある返信は持たない。 */
  createdAt: string | null;
  /** スプレッドシートの返信列（左から0）。書き込み前と書き込み失敗では null。 */
  sheetReplyIndex: number | null;
};

/**
 * 返信を書かれた順に並べる。
 *
 * スプレッドシートの返信列は左から古い順なので、列を持つ返信はその順に並ぶ。
 * 列を持たない返信（書き込み前・作者が未連携・書き込み失敗）は、
 * それ自体の投稿時刻より前に書かれたアプリ返信の列へ寄せる。
 *
 * 列の有無で先後を決めてしまうと、アプリから返信した直後は列が無いので末尾に出て、
 * 書き込みが終わって列が届いた瞬間に前へ跳ねる。寄せる先を時刻で決めておけば、
 * 列が付く前後で並びは変わらない。
 */
export function sortRepliesInWrittenOrder<T>(
  replies: T[],
  describe: (reply: T) => ReplyOrderInput,
): T[] {
  // 時刻と列の両方を知っているのは、シートへ書き終えたアプリ返信だけ。
  const anchors = replies
    .map(describe)
    .flatMap((reply) =>
      reply.createdAt != null && reply.sheetReplyIndex != null
        ? [{ createdAt: reply.createdAt, column: reply.sheetReplyIndex }]
        : [],
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const columnWrittenBefore = (createdAt: string) => {
    let column = -1;
    for (const anchor of anchors) {
      if (anchor.createdAt >= createdAt) break;
      if (anchor.column > column) column = anchor.column;
    }
    return column;
  };

  return replies
    .map((reply) => {
      const { id, createdAt, sheetReplyIndex } = describe(reply);
      return {
        reply,
        column:
          sheetReplyIndex ?? (createdAt != null ? columnWrittenBefore(createdAt) : -1),
        // 同じ列へ寄った中では、その列の返信が先。後から続く返信は投稿順。
        after: sheetReplyIndex != null ? "" : createdAt ?? "",
        id,
      };
    })
    .sort(
      (a, b) =>
        a.column - b.column || a.after.localeCompare(b.after) || a.id.localeCompare(b.id),
    )
    .map(({ reply }) => reply);
}
