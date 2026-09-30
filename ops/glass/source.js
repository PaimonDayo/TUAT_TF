// TUAT bounded viewport capture for simple-liquid-glass (MIT).
import { toCanvas } from "html-to-image";
const sources = /* @__PURE__ */ new WeakMap();
class Source {
  constructor(element) {
    this.element = element;
    this.observer = new MutationObserver(this.changed);
    this.observer.observe(element, { subtree: true, childList: true, characterData: true, attributes: true });
    this.resize = new ResizeObserver(this.changed);
    this.resize.observe(element);
    element.addEventListener("load", this.changed, true);
    element.addEventListener("input", this.changed, true);
    document.addEventListener("pointerdown", this.interacting, true);
    document.addEventListener("touchstart", this.interacting, { passive: true, capture: true });
    document.addEventListener("click", this.interacting, true);
    window.addEventListener("scroll", this.interacting, { passive: true });
    window.addEventListener("resize", this.changed);
    window.visualViewport?.addEventListener("resize", this.changed);
  }
  capture = { cache: /* @__PURE__ */ new Map() };
  listeners = /* @__PURE__ */ new Set();
  observer;
  resize;
  timer;
  busy = false;
  disposed = false;
  dirty = true;
  revision = 0;
  quietUntil = 0;
  schedule = () => {
    if (this.disposed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = void 0;
      void this.run();
    }, 220);
  };
  changed = () => {
    this.dirty = true;
    this.revision++;
    this.schedule();
  };
  interacting = () => {
    this.quietUntil = performance.now() + 240;
    this.schedule();
  };
  refresh = async () => {
    this.changed();
  };
  async run() {
    if (this.disposed || document.hidden) return;
    if (this.busy || performance.now() < this.quietUntil || document.querySelector('.glass-bar[data-pressing="true"],.ios-glass-nav [aria-busy="true"]')) {
      this.schedule();
      return;
    }
    const bounds = this.element.getBoundingClientRect();
    const viewport = window.visualViewport;
    const bottom = viewport ? viewport.offsetTop + viewport.height : innerHeight;
    const prior = this.capture.cache.get(this.element);
    if (!this.dirty && prior && bottom - 110 >= bounds.top + prior.offsetTop && bottom + 20 <= bounds.top + prior.offsetTop + prior.cssHeight) return;
    // Keep the same fractional CSS dimensions used by the sampling rect.
    // offsetWidth/offsetHeight round them, reflowing the copied background.
    const width = bounds.width, fullHeight = bounds.height;
    if (!width || !fullHeight) return;
    const height = Math.min(384, fullHeight);
    const offsetTop = Math.max(0, Math.min(fullHeight - height, bottom - 230 - bounds.top));
    const top = bounds.top + offsetTop, end = top + height;
    const revision = this.revision;
    const visible = /* @__PURE__ */ new WeakMap();
    const filter = (node) => {
      if (node instanceof Element && node.matches("script,style,.app-floating-action,[data-liquid-glass-ignore]")) return false;
      const parent = node.parentElement;
      if (!parent || parent === this.element) return true;
      if (!visible.has(parent)) {
        const box = parent.getBoundingClientRect();
        visible.set(parent, box.height === 0 || box.bottom >= top - 16 && box.top <= end + 16);
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
    this.resize.disconnect();
    this.element.removeEventListener("load", this.changed, true);
    this.element.removeEventListener("input", this.changed, true);
    document.removeEventListener("pointerdown", this.interacting, true);
    document.removeEventListener("touchstart", this.interacting, true);
    document.removeEventListener("click", this.interacting, true);
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
