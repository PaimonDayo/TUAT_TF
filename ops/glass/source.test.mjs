import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readFileSync(new URL('./source.js', import.meta.url), 'utf8')
  .replace('import { toCanvas } from "html-to-image";', '')
  .replace(/export \{\s*acquireSource\s*\};/, 'globalThis.acquire = acquireSource;');

function fixture({ height = 3000, top = -750 } = {}) {
  const timers = new Map(), observers = [], captures = [], hubs = [];
  let now = 1000, nextTimer = 0, modal = false, blockedCapture;
  class Hub {
    listeners = new Map();
    constructor() { hubs.push(this); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    emit(type) { for (const fn of this.listeners.get(type) ?? []) fn({ type }); }
  }
  class Element extends Hub {
    constructor({ excluded = false, trigger = false, styling = false, parent = null } = {}) { super(); this.excluded = excluded; this.trigger = trigger; this.styling = styling; this.parentElement = parent; }
    matches(selector) { return selector === '[data-glass-menu-trigger]' ? this.trigger : selector === '[data-new-ui],[data-system-glass-preview]' ? this.styling : this.excluded; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
    querySelector() { return null; }
    getBoundingClientRect() { return { width: 390, height, top, bottom: top + height }; }
  }
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  }
  const document = Object.assign(new Hub(), { body: new Element(), hidden: false, querySelector: s => s.startsWith('[role=') && modal ? {} : null });
  const window = Object.assign(new Hub(), { visualViewport: Object.assign(new Hub(), { offsetTop: 0, height: 844 }) });
  const element = new Element();
  const context = { Element, MutationObserver: Observer, ResizeObserver: Observer, window, document, innerHeight: 844, devicePixelRatio: 2,
    performance: { now: () => now }, setTimeout: (fn) => { const id = ++nextTimer; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    toCanvas: async (_, options) => { const canvas = { width: options.width * options.pixelRatio, height: options.height * options.pixelRatio }; captures.push({ canvas, options }); if (blockedCapture) await blockedCapture; return canvas; },
  };
  runInNewContext(source, context);
  const shared = context.acquire(element, () => {});
  const mutations = records => observers.find(o => o.target === element && !o.disconnected).callback(records);
  const attribute = (name, target = element) => ({ type: 'attributes', attributeName: name, target });
  const flush = async () => { now += 500; const batch = [...timers.values()]; timers.clear(); for (const fn of batch) fn(); for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return { element, shared, captures, observers, timers, attribute, mutations, flush, document,
    child: options => new Element({ parent: element, ...options }),
    modal(open) { modal = open; observers.find(o => o.target === document.body && !o.disconnected).callback([]); },
    bounds(newTop) { top = newTop; },
    block() { let resolve; blockedCapture = new Promise(r => { resolve = r; }); return () => { blockedCapture = null; resolve(); }; },
    listenerCount: () => hubs.reduce((n, h) => n + [...h.listeners.values()].reduce((m, s) => m + s.size, 0), 0),
  };
}
async function warm(f) { await f.shared.refresh(); await f.flush(); assert.equal(f.captures.length, 1); }

test('opening and closing a portal reuses an unchanged snapshot', async () => {
  const f = fixture(); await warm(f);
  for (let i = 0; i < 3; i++) {
    f.modal(true); assert.equal(f.shared.capture.suspended, true);
    f.mutations([f.attribute('aria-hidden'), f.attribute('data-aria-hidden')]);
    await f.flush(); f.modal(false); await f.flush();
  }
  assert.equal(f.shared.capture.suspended, false); assert.equal(f.captures.length, 1); f.shared.release();
});
test('transient presses and menu trigger state do not invalidate paint; selected content does', async () => {
  const f = fixture(); await warm(f); const trigger = f.child({ trigger: true });
  f.mutations([f.attribute('data-glass-pressed'), f.attribute('data-glass-pointer-focus'), f.attribute('data-state', trigger), f.attribute('aria-expanded', trigger)]);
  await f.flush(); assert.equal(f.captures.length, 1);
  f.mutations([f.attribute('aria-pressed', f.child())]); await f.flush(); assert.equal(f.captures.length, 2); f.shared.release();
});
test('excluded floating controls neither repaint themselves nor invalidate their parent', async () => {
  const f = fixture(); await warm(f); const floating = f.child({ excluded: true }), icon = f.child({ parent: floating });
  f.mutations([f.attribute('class', icon), { type: 'childList', target: f.element, addedNodes: [], removedNodes: [floating] }]);
  await f.flush(); assert.equal(f.captures.length, 1); f.shared.release();
});
test('real edits under an open dialog coalesce and render when the final dialog closes', async () => {
  const f = fixture(); await warm(f); f.modal(true);
  f.mutations([{ type: 'characterData', target: { parentElement: f.element } }]);
  f.mutations([f.attribute('style')]); await f.flush(); assert.equal(f.captures.length, 1);
  f.modal(true); await f.flush(); assert.equal(f.captures.length, 1);
  f.modal(false); await f.flush(); assert.equal(f.captures.length, 2);
  assert.equal(f.captures[0].canvas.width, 0); assert.equal(f.captures[1].options.height, 384); assert.equal(f.captures[1].options.pixelRatio, 1.5); f.shared.release();
});
test('the hidden new-UI marker still invalidates global styling when toggled', async () => {
  const f = fixture(); await warm(f); const marker = f.child({ excluded: true, styling: true });
  for (const record of [
    { type: 'childList', target: f.element, addedNodes: [marker], removedNodes: [] },
    { type: 'childList', target: f.element, addedNodes: [], removedNodes: [marker] },
    f.attribute('data-new-ui', marker),
  ]) { const before = f.captures.length; f.mutations([record]); await f.flush(); assert.equal(f.captures.length, before + 1); }
  f.shared.release();
});
test('end-of-page cache coverage does not request an impossible strip beyond the page', async () => {
  for (const bounds of [{ height: 844, top: 0 }, { height: 3000, top: -2156 }]) {
    const f = fixture(bounds); await warm(f); f.document.emit('click'); await f.flush(); assert.equal(f.captures.length, 1); f.shared.release();
  }
});
test('scrolling beyond the cached strip still refreshes', async () => {
  const f = fixture(); await warm(f); f.bounds(-1300); f.document.emit('click'); await f.flush(); assert.equal(f.captures.length, 2); f.shared.release();
});
test('a real change during capture discards stale pixels and preserves the pending refresh', async () => {
  const f = fixture(); await warm(f); const unblock = f.block(); await f.shared.refresh(); await f.flush();
  f.modal(true); f.mutations([f.attribute('class')]); unblock(); await f.flush();
  assert.equal(f.captures[1].canvas.width, 0); f.modal(false); await f.flush(); assert.equal(f.captures.length, 3); f.shared.release();
});
test('release removes timers, observers, event listeners and cached pixels', async () => {
  const f = fixture(); await warm(f); f.modal(true); f.modal(false); assert.ok(f.timers.size);
  f.shared.release(); assert.equal(f.timers.size, 0); assert.equal(f.listenerCount(), 0); assert.ok(f.observers.every(o => o.disconnected)); assert.equal(f.shared.capture.cache.size, 0);
  await f.flush(); assert.equal(f.captures.length, 1);
});
