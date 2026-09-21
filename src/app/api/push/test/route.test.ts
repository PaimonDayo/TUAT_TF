import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }) }));
import { POST } from './route';
const request = (body: unknown) => new Request('https://example.test/api/push/test', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => { mocks.getUser.mockResolvedValue({ data: { user: { id: 'self' } } }); mocks.rpc.mockResolvedValue({ data: { sent: true }, error: null }); });
describe('device-scoped test push', () => {
 it('requires a signed-in member', async () => { mocks.getUser.mockResolvedValue({ data: { user: null } }); expect((await POST(request({ endpoint: 'https://example.test/push' }))).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it('rejects missing endpoint instead of broadcasting to all devices', async () => { expect((await POST(request({}))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled(); });
 it('passes only this device endpoint to the ownership-checking RPC', async () => { expect((await POST(request({ endpoint: 'https://example.test/push', user_id: 'other' }))).status).toBe(200); expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('send_test_push_to_subscription', { subscription_endpoint: 'https://example.test/push' }); });
 it('does not claim delivery for an unregistered device', async () => { mocks.rpc.mockResolvedValue({ data: { sent: false, reason: 'no_subscription' }, error: null }); expect((await (await POST(request({ endpoint: 'https://example.test/push' }))).json()).ok).toBe(false); });
});
