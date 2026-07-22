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
