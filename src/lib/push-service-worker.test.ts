import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';
it('uses notification identity to collapse redelivery but preserves different notifications', async () => {
 const handlers = new Map<string, (event: unknown) => void>();
 const showNotification = vi.fn(async () => undefined);
 vm.runInNewContext(readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), { self: { addEventListener: (kind: string, fn: (event: unknown) => void) => handlers.set(kind, fn), registration: { showNotification } } });
 for (const id of ['a','a','b']) {
   let pending: Promise<unknown> | undefined;
   handlers.get('push')!({ data: { json: () => ({ title: 'Test', body: 'Test', data: { notificationId: id } }) }, waitUntil: (p: Promise<unknown>) => { pending = p; } });
   await pending;
 }
 expect(showNotification.mock.calls.map(c => (c as unknown as [string, {tag:string}])[1].tag)).toEqual(['notification-a','notification-a','notification-b']);
});
