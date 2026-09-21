import test from 'node:test';
import assert from 'node:assert/strict';
import { planRetention } from './backup-retention.mjs';
const now = Date.parse('2026-09-21T07:00:00.000Z');
const day = 86400000;
const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
function object(time, instance = a, kind = 'dump') {
 return { key: `ops/pc-backend/${instance}/backups/${new Date(time).toISOString().replace(/[:.]/g, '-')}.${kind}.enc`, size: 100, etag: 'test-only' };
}
test('keeps every generation within 24 hours and one newest per older JST day', () => {
 const objects = [object(now), object(now-1000), object(now-day), object(now-2*day), object(now-2*day-1000), object(now-3*day)];
 const plan = planRetention(objects, now);
 assert.equal(plan.keep.length, 5);
 assert.deepEqual(plan.remove, [objects[4]]);
});
test('uses Japan calendar boundaries and removes older than 30 days', () => {
 const objects = [object(now), object(Date.parse('2026-09-18T15:01:00Z')), object(Date.parse('2026-09-18T14:59:00Z')), object(now-31*day)];
 const plan = planRetention(objects, now);
 assert.equal(plan.keep.length, 3);
 assert.deepEqual(plan.remove, [objects[3]]);
});
test('preserves final generation of retired instances and handles instances separately', () => {
 const objects = [object(now), object(now-40*day,b), object(now-41*day,b)];
 const plan = planRetention(objects,now);
 assert.deepEqual(plan.keep,objects.slice(0,2));
 assert.deepEqual(plan.remove,[objects[2]]);
 assert.equal(plan.newest.length,2);
});
test('keeps or removes recovery metadata together with its database', () => {
 const objects=[object(now),object(now-2*day),object(now-2*day,a,'recovery.json'),object(now-2*day-1000),object(now-2*day-1000,a,'recovery.json')];
 const plan=planRetention(objects,now);
 assert.deepEqual(plan.keep,objects.slice(0,3));
 assert.deepEqual(plan.remove,objects.slice(3));
});
test('unknown keys, images, orphan recovery and future dates are never deleted', () => {
 const objects=[{key:'images/member.png'}, {key:`ops/pc-backend/${a}/backups/unknown.enc`},object(now-40*day,a,'recovery.json'),object(now+day)];
 const plan=planRetention(objects,now);
 assert.equal(plan.remove.length,0);
 assert.equal(plan.untouched.length,4);
});
