// Public CSV fetches vary in latency. Keep each serverless request comfortably
// below the 60-second limit; the caller advances through multiple chunks.
const DEFAULT_CHUNK_SIZE = 12;
const MAX_CHUNK_SIZE = 12;

export function sheetSyncChunkSize(rawValue = process.env.SHEET_SYNC_CHUNK_SIZE): number {
  const parsed = Number.parseInt(rawValue ?? String(DEFAULT_CHUNK_SIZE), 10);
  return Number.isFinite(parsed)
    ? Math.min(MAX_CHUNK_SIZE, Math.max(1, parsed))
    : DEFAULT_CHUNK_SIZE;
}
