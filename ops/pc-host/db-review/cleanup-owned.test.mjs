import test from 'node:test';
import assert from 'node:assert/strict';
import { attemptResource, cleanupOwned } from './cleanup-owned.mjs';

const generation = '1'.repeat(32), base = `codex-auth-dbreview-${generation}`, network = `${base}-internal`;
const labels = { 'tuat.owner': 'codex-auth-db-review', 'tuat.generation': generation };
const image = {
  pg: 'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00',
  auth: 'sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232',
  storage: 'sha256:c24fb33cc2fa38d0f9582a30312907fc56da333fb9ba0646833186197e4982f3',
  api: 'sha256:54000f24847d01a2c2302e0041cf0618b875c57fb48507d743cfa9aaa50bf43c',
};
const suffix = { pg: '', auth: '-auth-migrate', storage: '-storage-source', api: '-postgrest' };
function fixture() {
  const containers = new Map(), calls = [], removals = [];
  let net = { id: 'e'.repeat(64), name: network, labels: { ...labels }, internal: true, otherContainers: {} }, volume;
  const add = (kind, state = 'running') => {
    const name = base + suffix[kind];
    const item = { id: String(Object.keys(image).indexOf(kind) + 1).repeat(64), name: `/${name}`, labels: { ...labels }, image: image[kind], ports: {}, mode: kind === 'storage' ? 'none' : network, networks: state === 'created' ? {} : { [kind === 'storage' ? 'none' : network]: {} }, state };
    containers.set(name, item); return item;
  };
  const docker = async args => {
    calls.push(args);
    if ((args[0] === 'container' && args[1] === 'ls') || (['network', 'volume'].includes(args[0]) && args[1] === 'ls')) {
      const filter = args[args.indexOf('--filter') + 1], name = filter.replace(/^name=\^\/?/, '').replace(/\$$/, '');
      if (args[0] === 'container') return containers.get(name)?.id ?? '';
      if (args[0] === 'volume') return volume?.name === name ? name : '';
      return net?.name === name ? net.id : '';
    }
    if (args[0] === 'inspect') {
      const item = containers.get(args.at(-1)); assert.ok(item, 'inspect exact existing container');
      return JSON.stringify([item.id, item.name, item.labels, item.image, item.ports, item.mode, item.networks, item.state]);
    }
    if (args[0] === 'network' && args[1] === 'inspect') {
      assert.equal(args.at(-1), network); assert.ok(net);
      const attached = { ...net.otherContainers };
      for (const item of containers.values()) if (item.mode === network && item.state !== 'created') attached[item.id] = {};
      return JSON.stringify([net.id, net.name, net.labels, net.internal, attached]);
    }
    if (args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify([volume.name, volume.labels, volume.mountpoint]);
    if (args[0] === 'rm') {
      const entry = [...containers].find(([, item]) => item.id === args.at(-1)); assert.ok(entry, 'remove exact inspected ID');
      containers.delete(entry[0]); removals.push(args); return '';
    }
    if (args[0] === 'volume' && args[1] === 'rm') { assert.equal(args[2], volume.name); volume = undefined; removals.push(args); return ''; }
    if (args[0] === 'network' && args[1] === 'rm') { assert.equal(args[2], net.id); net = undefined; removals.push(args); return ''; }
    throw Error('Unexpected fake Docker action');
  };
  return { add, docker, calls, removals, containers, get net() { return net; }, set net(value) { net = value; }, get volume() { return volume; }, set volume(value) { volume = value; } };
}

for (const kind of ['pg', 'auth', 'storage', 'api']) test(`unknown ${kind} creation is reconciled without a returned ID`, async () => {
  const f = fixture(), attempted = {};
  await assert.rejects(attemptResource(attempted, kind, async () => { f.add(kind, 'created'); throw Error('Create process timed out after daemon created resource'); }));
  assert.equal(attempted[kind], true);
  const result = await cleanupOwned({ generation, attempted, docker: f.docker });
  assert.equal(result.removed, 1); assert.equal(f.containers.size, 0);
  assert.ok(f.calls.every(args => !args.includes('{{json .Config.Env}}') && !args.includes('{{json .}}')));
});

test('unknown network creation is reconciled and absent attempts are inspected', async () => {
  const f = fixture(), attempted = {};
  await assert.rejects(attemptResource(attempted, 'network', async () => { throw Error('Network created before timeout'); }));
  const result = await cleanupOwned({ generation, attempted: { ...attempted, pg: true, auth: true, storage: true, api: true, volume: true }, docker: f.docker });
  assert.equal(result.removed, 1); assert.equal(result.absent, 5); assert.equal(f.net, undefined);
});

test('unknown volume creation is reconciled by exact labelled mountpoint', async () => {
  const f = fixture(), attempted = {};
  await assert.rejects(attemptResource(attempted, 'volume', async () => {
    f.volume = { name: `${base}-data`, labels: { ...labels }, mountpoint: `/var/lib/docker/volumes/${base}-data/_data` };
    throw Error('Volume created before response was lost');
  }));
  const result = await cleanupOwned({ generation, attempted, docker: f.docker });
  assert.equal(result.removed, 1); assert.equal(f.volume, undefined);
});

test('all exact attempted resources removed in container-volume-network order', async () => {
  const f = fixture(); for (const kind of Object.keys(image)) f.add(kind);
  f.volume = { name: `${base}-data`, labels: { ...labels }, mountpoint: `/var/lib/docker/volumes/${base}-data/_data` };
  const result = await cleanupOwned({ generation, attempted: { pg: true, auth: true, storage: true, api: true, volume: true, network: true }, docker: f.docker });
  assert.equal(result.removed, 6); assert.equal(result.inspected, 6);
  assert.deepEqual(f.removals.slice(-2).map(args => args[0]), ['volume', 'network']);
  assert.ok(f.calls.filter(args => args.includes('--filter')).every(args => args[args.indexOf('--filter') + 1].includes(base)));
});

const violations = {
  owner: item => { item.labels['tuat.owner'] = 'other'; },
  generation: item => { item.labels['tuat.generation'] = '2'.repeat(32); },
  name: item => { item.name = '/supabase-db'; },
  id: item => { item.id = 'invalid'; },
  image: item => { item.image = 'sha256:' + 'a'.repeat(64); },
  ports: item => { item.ports = { '3000/tcp': [{ HostPort: '3000' }] }; },
  malformedPorts: item => { item.ports = []; },
  network: item => { item.mode = 'bridge'; },
  extraNetwork: item => { item.networks.bridge = {}; },
};
for (const [name, mutate] of Object.entries(violations)) test(`API ${name} mismatch retains resource`, async () => {
  const f = fixture(); mutate(f.add('api'));
  await assert.rejects(cleanupOwned({ generation, attempted: { api: true }, docker: f.docker }));
  assert.equal(f.removals.length, 0); assert.equal(f.containers.size, 1);
});

test('external or mismatched internal network blocks removal', async () => {
  for (const mutate of [net => { net.internal = false; }, net => { net.labels['tuat.owner'] = 'other'; }, net => { net.id = 'bad'; }, net => { net.name = 'supabase-network'; }]) {
    const f = fixture(); f.add('pg'); mutate(f.net);
    await assert.rejects(cleanupOwned({ generation, attempted: { pg: true }, docker: f.docker })); assert.equal(f.removals.length, 0);
  }
});

test('volume path escapes and unknown occupants prevent deletion', async () => {
  const f = fixture(); f.volume = { name: `${base}-data`, labels, mountpoint: `/var/lib/docker/../volumes/${base}-data/_data` };
  await assert.rejects(cleanupOwned({ generation, attempted: { volume: true }, docker: f.docker })); assert.equal(f.removals.length, 0);
  f.net.otherContainers.unowned = {};
  await assert.rejects(cleanupOwned({ generation, attempted: { network: true }, docker: f.docker })); assert.equal(f.removals.length, 0);
});

test('unknown list/inspect/remove result cannot become successful cleanup', async () => {
  for (const failAt of ['list', 'inspect', 'remove']) {
    const f = fixture(); f.add('api');
    const docker = async args => {
      if ((failAt === 'list' && args[0] === 'container' && args[1] === 'ls') || (failAt === 'inspect' && args[0] === 'inspect') || (failAt === 'remove' && args[0] === 'rm')) throw Error('Process result unknown');
      return f.docker(args);
    };
    await assert.rejects(cleanupOwned({ generation, attempted: { api: true }, docker })); assert.equal(f.removals.length, 0);
  }
});

test('daemon still listing resource after remove is not cleanup success', async () => {
  const f = fixture(); f.add('api');
  await assert.rejects(cleanupOwned({ generation, attempted: { api: true }, docker: args => args[0] === 'rm' ? Promise.resolve('') : f.docker(args) }), /not confirmed/);
});

test('invalid scope and unattempted resources never invoke mutation', async () => {
  const f = fixture(); f.add('api');
  for (const input of [{ generation: 'supabase-db', attempted: {} }, { generation, attempted: { other: true } }, { generation, attempted: { pg: 'true' } }]) await assert.rejects(cleanupOwned({ ...input, docker: f.docker }));
  assert.equal(f.calls.length, 0);
  const result = await cleanupOwned({ generation, attempted: {}, docker: f.docker }); assert.equal(result.removed, 0); assert.equal(f.calls.length, 0);
});
