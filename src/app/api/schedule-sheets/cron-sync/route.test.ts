import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), writes: vi.fn(), validate: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mocks.from }) }));
vi.mock('@/lib/schedule-import', () => ({
  buildHeaderRow: () => ['date'], canonicalImportValues: () => ({}), detectHeaderRowIndex: () => 0,
  googleSheetCsvUrl: () => new URL('https://docs.google.com/spreadsheets/d/synthetic/export?format=csv'),
  validateScheduleImportRows: mocks.validate,
}));
import { POST } from './route';
beforeEach(() => {
  vi.stubEnv('SHEET_SYNC_SECRET', 'test-secret');
  mocks.from.mockReset(); mocks.writes.mockReset(); mocks.validate.mockReset();
  mocks.validate.mockReturnValue({ additions: [{ schedule_date: '2026-09-27' }], updates: [], errors: [] });
  mocks.from.mockImplementation((table: string) => {
    const data = table === 'schedule_sheets' ? [{ id: 'synthetic', kind: 'practice', csv_url: 'synthetic' }] : [];
    const query: Record<string, unknown> = { then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve({data,error:null})) };
    for (const name of ['select','eq','not','order','gte','lt']) query[name] = () => query;
    for (const name of ['insert','update','delete','upsert']) query[name] = mocks.writes;
    return query;
  });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('date\n2026-09-27')));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const request = (authorized = true) => new Request('http://localhost/api/schedule-sheets/cron-sync', {
  method: 'POST', headers: authorized ? { authorization: 'Bearer test-secret' } : {}, body: JSON.stringify({ dryRun: true }),
});
describe('scheduled import preflight', () => {
  it('does not write additions or last-imported timestamps in dryRun', async () => {
    const response = await POST(request());
    const result = await response.json();
    expect(result).toMatchObject({ok:true,dryRun:true,results:[{additions:1,updates:0}]});
    expect(mocks.writes).not.toHaveBeenCalled();
  });
  it('reports an inaccessible spreadsheet as failed rather than overall success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null,{status:401})));
    expect(await (await POST(request())).json()).toMatchObject({ok:false,results:[{error:'HTTP 401'}]});
    expect(mocks.writes).not.toHaveBeenCalled();
  });
  it('rejects preflight without the existing sync credential', async () => {
    expect((await POST(request(false))).status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
