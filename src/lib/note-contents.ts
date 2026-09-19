/**
 * フォルダの中身の内訳を1行で表す。
 *
 * 以前は記事の数しか出しておらず、サブフォルダやスレッドだけが入っている
 * フォルダが「0件の記事」と表示されて空に見えた（オーナー指摘 2026-09-19）。
 * 0件の種類は並べず、本当に空のときだけ空だと分かる文にする。
 * 並び順はフォルダ詳細の節（サブフォルダ→記事→スレッド）に合わせる。
 */
export function folderContentsLabel(note: {
  children?: { id: string }[] | null;
  articles?: { id: string }[] | null;
  threads?: { id: string }[] | null;
}): string {
  const parts: string[] = [];
  const folders = note.children?.length ?? 0;
  const articles = note.articles?.length ?? 0;
  const threads = note.threads?.length ?? 0;
  if (folders > 0) parts.push(`フォルダ${folders}件`);
  if (articles > 0) parts.push(`記事${articles}件`);
  if (threads > 0) parts.push(`スレッド${threads}件`);
  return parts.length > 0 ? parts.join(" · ") : "まだ中身はありません";
}
