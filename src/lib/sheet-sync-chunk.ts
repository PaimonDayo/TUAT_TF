// The scheduled pull runs only once per day, so one invocation must cover the
// whole expected club size. Vercel Pro allows enough wall-clock time for this
// I/O-heavy operation; the cap still prevents an accidental unbounded batch.
const DEFAULT_CHUNK_SIZE = 100;
const MAX_CHUNK_SIZE = 100;

export function sheetSyncChunkSize(rawValue = process.env.SHEET_SYNC_CHUNK_SIZE): number {
  const parsed = Number.parseInt(rawValue ?? String(DEFAULT_CHUNK_SIZE), 10);
  return Number.isFinite(parsed)
    ? Math.min(MAX_CHUNK_SIZE, Math.max(1, parsed))
    : DEFAULT_CHUNK_SIZE;
}
