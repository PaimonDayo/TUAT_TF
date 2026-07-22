const DEFAULT_CHUNK_SIZE = 16;
const MAX_CHUNK_SIZE = 30;

export function sheetSyncChunkSize(rawValue = process.env.SHEET_SYNC_CHUNK_SIZE): number {
  const parsed = Number.parseInt(rawValue ?? String(DEFAULT_CHUNK_SIZE), 10);
  return Number.isFinite(parsed)
    ? Math.min(MAX_CHUNK_SIZE, Math.max(1, parsed))
    : DEFAULT_CHUNK_SIZE;
}
