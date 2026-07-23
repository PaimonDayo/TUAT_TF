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

export function importedSheetReplies(
  replies: RawSheetReply[],
  exportedAppReplies: Iterable<string>,
): ImportedSheetReply[] {
  const exported = new Set(
    Array.from(exportedAppReplies, normalizeSheetReplyText).filter(Boolean),
  );
  const byIndex = new Map<number, ImportedSheetReply>();

  for (const reply of replies) {
    const content = reply.content.trim();
    if (
      reply.source !== "sheet" ||
      !Number.isInteger(reply.replyIndex) ||
      reply.replyIndex < 0 ||
      !content ||
      content.length > 2000 ||
      exported.has(normalizeSheetReplyText(content))
    ) {
      continue;
    }
    byIndex.set(reply.replyIndex, { replyIndex: reply.replyIndex, content });
  }

  return [...byIndex.values()].sort((a, b) => a.replyIndex - b.replyIndex);
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
