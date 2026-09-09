/**
 * ノート記事の本文に写真の位置を持たせる。
 *
 * 本文は今までどおり `note_articles.body` のただのテキストで、その中に
 * `[[photo:<キー>]]` という目印を1行として置くことで挿入位置を表す。
 * 目印は編集画面でも閲覧画面でもそのまま出さず、写真そのものに置き換える。
 *
 * キーは画像の保存先パス `<記事ID>/<キー>.webp` の真ん中の部分。
 * これは写真を選んだ瞬間（アップロード前）に決まるので、保存前に本文へ
 * 差し込んでも、保存後にそのまま同じ写真を指す。
 */

const PHOTO_TOKEN = /\[\[photo:([0-9a-fA-F-]{36})\]\]/g;

export type NoteBlock =
  | { type: "text"; text: string }
  | { type: "photo"; key: string };

/** 画像の保存先パスから、本文で使うキーを取り出す */
export function photoKeyFromPath(path: string): string | null {
  const name = path.split("/")[1];
  if (!name) return null;
  const key = name.replace(/\.webp$/i, "");
  return /^[0-9a-fA-F-]{36}$/.test(key) ? key : null;
}

export function photoToken(key: string): string {
  return `[[photo:${key}]]`;
}

/**
 * 本文を「文章」と「写真」の並びへ分解する。
 * 文章の中身（改行・空白）は写真の前後の目印の分を除いてそのまま残す。
 */
export function parseNoteBody(body: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let cursor = 0;
  for (const match of body.matchAll(PHOTO_TOKEN)) {
    const start = match.index ?? 0;
    blocks.push({ type: "text", text: trimOneEdgeNewline(body.slice(cursor, start), "end") });
    blocks.push({ type: "photo", key: match[1] });
    cursor = start + match[0].length;
  }
  blocks.push({ type: "text", text: trimOneEdgeNewline(body.slice(cursor), "start") });
  return normalizeNoteBlocks(blocks);
}

/** 本文へ書き戻す。写真の前後には改行を1つずつ置き、目印を単独行にする。 */
export function serializeNoteBlocks(blocks: NoteBlock[]): string {
  return normalizeNoteBlocks(blocks)
    .map((block) => (block.type === "photo" ? photoToken(block.key) : block.text))
    .join("\n")
    .trim();
}

/** 本文が指している写真のキー（重複は1つに、出てくる順） */
export function referencedPhotoKeys(body: string): string[] {
  return [...new Set([...body.matchAll(PHOTO_TOKEN)].map((match) => match[1]))];
}

/**
 * 文章と写真が必ず交互になるよう整える。
 * 続いた文章はつなぎ、写真どうしの間と前後には空の文章を入れて、
 * どの写真の前にも後ろにも文字を書ける状態にする。
 */
export function normalizeNoteBlocks(blocks: NoteBlock[]): NoteBlock[] {
  const merged: NoteBlock[] = [];
  for (const block of blocks) {
    const last = merged[merged.length - 1];
    if (block.type === "text" && last?.type === "text") {
      last.text = last.text ? `${last.text}\n${block.text}` : block.text;
      continue;
    }
    merged.push(block.type === "text" ? { type: "text", text: block.text } : { ...block });
  }
  const result: NoteBlock[] = [];
  for (const block of merged) {
    if (block.type === "photo" && result[result.length - 1]?.type !== "text") {
      result.push({ type: "text", text: "" });
    }
    result.push(block);
  }
  if (result[result.length - 1]?.type !== "text") result.push({ type: "text", text: "" });
  if (result.length === 0) result.push({ type: "text", text: "" });
  return result;
}

/**
 * 文章ブロックの caret 位置で写真を差し込む。
 * その位置で文章を2つに割り、間へ写真を置く。
 */
export function insertPhotoAt(
  blocks: NoteBlock[],
  textIndex: number,
  caret: number,
  key: string,
): NoteBlock[] {
  const target = blocks[textIndex];
  if (!target || target.type !== "text") {
    return normalizeNoteBlocks([...blocks, { type: "photo", key }]);
  }
  const position = Math.max(0, Math.min(caret, target.text.length));
  return normalizeNoteBlocks([
    ...blocks.slice(0, textIndex),
    { type: "text", text: target.text.slice(0, position) },
    { type: "photo", key },
    { type: "text", text: target.text.slice(position) },
    ...blocks.slice(textIndex + 1),
  ]);
}

/** 本文から写真を外す（写真そのものは記事に残る） */
export function removePhotoBlock(blocks: NoteBlock[], key: string): NoteBlock[] {
  return normalizeNoteBlocks(
    blocks.filter((block) => !(block.type === "photo" && block.key === key)),
  );
}

/**
 * 一覧などで本文を途中まで見せる。写真の目印を途中で切ると本文に生の文字列が出るので、
 * 切れてしまう目印は丸ごと落とす。
 */
export function truncateNoteBody(body: string, limit: number): string {
  if (body.length <= limit) return body;
  let cut = limit;
  for (const match of body.matchAll(PHOTO_TOKEN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start < limit && end > limit) cut = start;
  }
  return body.slice(0, cut);
}

/** 目印の前後に入れた改行1つだけを取り除く（本文の空行は保つ） */
function trimOneEdgeNewline(text: string, edge: "start" | "end"): string {
  if (edge === "end") return text.replace(/\r?\n$/, "");
  return text.replace(/^\r?\n/, "");
}
