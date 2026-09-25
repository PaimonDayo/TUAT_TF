/** DBの窓口（PostgREST）が1回に返す上限。これを超える件数は1回の問い合わせでは取り切れない。 */
export const DB_PAGE_SIZE = 1000;

/**
 * 上限を超えうる一覧を、ページに分けて全件読む。
 * fetchPage には、並び順を固定した問い合わせに .range(from, to) を付けたものを渡すこと
 * （並び順が決まっていないとページの境目で行が重複・欠落する）。
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = DB_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}
