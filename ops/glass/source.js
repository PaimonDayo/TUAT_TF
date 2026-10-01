// TUAT bounded viewport capture for simple-liquid-glass (MIT).
import { toCanvas } from "html-to-image";
const sources = /* @__PURE__ */ new WeakMap();
const excluded = "script,style,.app-floating-action,[data-liquid-glass-ignore]";
const stylingMarker = "[data-new-ui],[data-system-glass-preview]";
const overlays = '[role="dialog"],[role="alertdialog"],[data-glass-create-menu]';
// These changes alone do not need a new backdrop: press feedback is transient,
// and Radix's accessibility hiding does not alter the background's appearance.
const nonVisual = new Set(["aria-hidden", "data-aria-hidden", "data-glass-pressed", "data-glass-pointer-focus"]);
const menuState = new Set(["data-state", "aria-expanded", "aria-controls"]);
function affectsCapture(record) {
  const element = record.target instanceof Element ? record.target : record.target.parentElement;
  // This hidden marker changes the CSS/layout of the entire source tree.
  if (record.type === "attributes" && ["data-new-ui", "data-system-glass-preview"].includes(record.attributeName)) return true;
  if (element?.closest(excluded)) return false;
  if (record.type === "attributes" && (nonVisual.has(record.attributeName)
    || element?.matches("[data-glass-menu-trigger]") && menuState.has(record.attributeName))) return false;
  if (record.type === "childList") {
    return [...record.addedNodes, ...record.removedNodes].some((node) => !(node instanceof Element)
      || node.matches(stylingMarker) || !node.matches(excluded));
  }
  return true;
}
class Source {
  constructor(element) {
    this.element = element;
    this.observer = new MutationObserver(this.mutated);
    this.observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
    this.portals = new MutationObserver(this.syncSuspended);
    this.portals.observe(document.body, { childList: true });
    this.resize = new ResizeObserver(this.changed);
    this.resize.observe(element);
    element.addEventListener("load", this.changed, true);
    element.addEventListener("input", this.changed, true);
    document.addEventListener("pointerdown", this.interacting, true);
    document.addEventListener("touchstart", this.interacting, { passive: true, capture: true });
    document.addEventListener("click", this.interacting, true);
    document.addEventListener("tuat:glass-route-change", this.routeChanged);
    window.addEventListener("scroll", this.interacting, { passive: true });
    window.addEventListener("resize", this.changed);
    window.visualViewport?.addEventListener("resize", this.changed);
    this.syncSuspended();
  }
  capture = { cache: /* @__PURE__ */ new Map(), suspended: false };
  listeners = /* @__PURE__ */ new Set();
  observer;
  portals;
  resize;
  timer;
  busy = false;
  disposed = false;
  dirty = true;
  revision = 0;
  quietUntil = 0;
  schedule = () => {
    if (this.disposed || this.capture.suspended) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = void 0;
      void this.run();
    }, 220);
  };
  syncSuspended = () => {
    const suspended = !!document.querySelector(overlays);
    if (suspended === this.capture.suspended) return;
    this.capture.suspended = suspended;
    if (suspended) {
      clearTimeout(this.timer);
      this.timer = void 0;
    } else {
      // Closing a portal does not change the backdrop. Reuse its snapshot, or
      // resume a real content change once focus/scroll restoration has settled.
      this.quietUntil = Math.max(this.quietUntil, performance.now() + 240);
      this.schedule();
    }
  };
  mutated = (records) => {
    this.syncSuspended();
    if (records.some(affectsCapture)) this.changed();
  };
  changed = () => {
    this.dirty = true;
    this.revision++;
    this.schedule();
  };
  routeChanged = () => {
    // A snapshot belongs to one page. Until the new page is captured, the
    // renderer uses the existing live CSS backdrop instead of old-page pixels.
    this.capture.cache.forEach((snapshot) => { snapshot.canvas.width = 0; });
    this.capture.cache.clear();
    this.changed();
    this.listeners.forEach((listener) => listener());
  };
  interacting = () => {
    this.quietUntil = performance.now() + 240;
    this.schedule();
  };
  refresh = async () => {
    this.changed();
  };
  async run() {
    if (this.disposed || document.hidden || this.capture.suspended) return;
    if (this.busy || performance.now() < this.quietUntil || document.querySelector('.glass-bar[data-pressing="true"],.ios-glass-nav [aria-busy="true"]')) {
      this.schedule();
      return;
    }
    const bounds = this.element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const bottom = viewport ? viewport.offsetTop + viewport.height : innerHeight;
    const prior = this.capture.cache.get(this.element);
    if (!this.dirty && prior && Math.max(bottom - 110, bounds.top) >= bounds.top + prior.offsetTop
      && Math.min(bottom + 20, bounds.bottom) <= bounds.top + prior.offsetTop + prior.cssHeight) return;
    // Keep the same fractional CSS dimensions used by the sampling rect.
    // offsetWidth/offsetHeight round them, reflowing the copied background.
    const width = bounds.width, fullHeight = bounds.height;
    if (!width || !fullHeight) return;
    const height = Math.min(384, fullHeight);
    const offsetTop = Math.max(0, Math.min(fullHeight - height, bottom - 230 - bounds.top));
    const top = bounds.top + offsetTop, end = top + height;
    const revision = this.revision;
    // Trial the layout fix only for the authenticated system preview.
    const preserveLayout = !!this.element.querySelector(":scope > [data-system-glass-preview]");
    const visible = /* @__PURE__ */ new WeakMap();
    const filter = (node) => {
      if (node instanceof Element && node.matches(excluded)) return false;
      const parent = node.parentElement;
      if (!parent || parent === this.element) return true;
      if (!visible.has(parent)) {
        const box = parent.getBoundingClientRect();
        let keep = box.height === 0 || box.bottom >= top - 16 && box.top <= end + 16;
        if (!keep && preserveLayout) {
          // Inline links can contain block cards. Removing their children
          // collapses the copied rows even though the link's measured box is
          // nonzero. Only prune inside boxes whose copied CSS keeps both axes.
          const style = getComputedStyle(parent);
          keep = style.display === "inline" || style.display === "contents"
            || !style.width.endsWith("px") || !style.height.endsWith("px");
        }
        visible.set(parent, keep);
      }
      return visible.get(parent);
    };
    this.busy = true;
    try {
      const canvas = await toCanvas(this.element, {
        width,
        height,
        pixelRatio: Math.min(devicePixelRatio || 1, 1.5),
        // The app uses system fonts; avoid scanning/downloading every stylesheet.
        fontEmbedCSS: "",
        // Avatar/media endpoints distinguish images by query string. A single
        // unreadable image (e.g. a cross-origin redirect) must not discard the
        // whole backdrop: keep its layout and capture the surrounding content.
        includeQueryParams: true,
        imagePlaceholder: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=",
        filter,
        style: {
          height: `${fullHeight}px`,
          transform: `translateY(${-offsetTop}px)`,
          translate: "none",
          transformOrigin: "top left",
          position: "static",
          margin: "0"
        }
      });
      if (this.disposed || revision !== this.revision) {
        canvas.width = 0;
        return;
      }
      this.capture.cache.set(this.element, { canvas, w: canvas.width, h: canvas.height, offsetTop, cssHeight: height });
      if (prior) prior.canvas.width = 0;
      this.dirty = false;
      this.listeners.forEach((listener) => listener());
    } catch (error) {
      this.listeners.forEach((listener) => listener(error));
    } finally {
      this.busy = false;
    }
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.observer.disconnect();
    this.portals.disconnect();
    this.resize.disconnect();
    this.element.removeEventListener("load", this.changed, true);
    this.element.removeEventListener("input", this.changed, true);
    document.removeEventListener("pointerdown", this.interacting, true);
    document.removeEventListener("touchstart", this.interacting, true);
    document.removeEventListener("click", this.interacting, true);
    document.removeEventListener("tuat:glass-route-change", this.routeChanged);
    window.removeEventListener("scroll", this.interacting);
    window.removeEventListener("resize", this.changed);
    window.visualViewport?.removeEventListener("resize", this.changed);
    this.capture.cache.forEach((snapshot) => {
      snapshot.canvas.width = 0;
    });
    this.capture.cache.clear();
  }
}
function acquireSource(element, listener) {
  let source = sources.get(element);
  if (!source) {
    source = new Source(element);
    sources.set(element, source);
  }
  source.listeners.add(listener);
  const shared = source;
  return { capture: shared.capture, refresh: shared.refresh, release() {
    shared.listeners.delete(listener);
    if (!shared.listeners.size) {
      shared.dispose();
      sources.delete(element);
    }
  } };
}
export {
  acquireSource
};
