import { spring } from "./glass-spring";

/** Preview a horizontal slide without changing the filter until release.
 * Vertical touch gestures remain native page scrolling (touch-action: pan-y). */
export function attachSegmentInteraction(root: HTMLElement, initial: number) {
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>(":scope > button"));
  const lens = root.querySelector<HTMLElement>("[data-glass-selection]")!;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const clamp = (x: number) => Math.max(0, Math.min(buttons.length - 1, x));
  const state = { x: Math.max(0, initial), v: 0 }, pressure = { x: 0, v: 0 }, shape = { x: 0, v: 0 };
  let selected = initial, target = state.x, frame = 0, last = 0, inputTime = 0, shapeTarget = 0;
  let suppressClick = false;
  let contact: { id: number; index: number; x: number; y: number; lastX: number; time: number; drag: boolean } | null = null;
  const removers: (() => void)[] = [];
  const listen = <K extends keyof WindowEventMap>(element: Window | HTMLElement, type: K, handler: (event: WindowEventMap[K]) => void, options?: AddEventListenerOptions) => {
    element.addEventListener(type, handler as EventListener, options);
    removers.push(() => element.removeEventListener(type, handler as EventListener, options));
  };
  const preview = (index: number) => buttons.forEach((button, i) => {
    button.toggleAttribute("data-glass-preview", !!contact && i === index);
  });
  function paint() {
    const p = reduced.matches ? 0 : Math.max(0, Math.min(1.025, pressure.x));
    const stretch = reduced.matches ? 0 : Math.abs(shape.x);
    lens.style.left = `calc(2px + (100% - 2px) / ${buttons.length} * ${state.x})`;
    // The lens lifts and stretches; the labels keep their original DOM geometry.
    lens.style.transform = `translateY(${-p * 1.2}px) scale(${1 + p * .08 + stretch}, ${1 + p * .12 - stretch * .42})`;
    lens.style.visibility = selected < 0 && !contact ? "hidden" : "";
  }
  const settled = (s: { x: number; v: number }, to: number) => Math.abs(s.x - to) < .001 && Math.abs(s.v) < .01;
  function tick(time: number) {
    const dt = Math.min((time - last) / 1000 || 1 / 60, .04); last = time;
    if (!contact?.drag) spring(state, target, dt);
    spring(pressure, contact ? 1 : 0, dt, 30, .82);
    if (time - inputTime > 45) shapeTarget = 0;
    spring(shape, shapeTarget, dt, 42, .85);
    if (settled(state, target) && settled(pressure, contact ? 1 : 0) && settled(shape, 0) && shapeTarget === 0) {
      state.x = target; state.v = 0; pressure.x = contact ? 1 : 0; pressure.v = 0; shape.x = shape.v = 0;
      frame = 0; paint(); return;
    }
    paint(); frame = requestAnimationFrame(tick);
  }
  function animate(next = target) {
    target = next;
    if (reduced.matches) {
      cancelAnimationFrame(frame); frame = 0;
      state.x = target; state.v = pressure.x = pressure.v = shape.x = shape.v = 0;
      paint(); return;
    }
    if (!frame) { last = performance.now(); frame = requestAnimationFrame(tick); }
  }
  function release() {
    const id = contact?.id;
    contact = null; shapeTarget = 0;
    root.removeAttribute("data-glass-sliding"); preview(-1);
    if (id !== undefined && root.hasPointerCapture(id)) root.releasePointerCapture(id);
  }
  function cancel() {
    release(); animate(Math.max(0, selected));
  }
  function coordinate(x: number) {
    const step = (root.getBoundingClientRect().width - 2) / buttons.length;
    return clamp(contact!.index + (x - contact!.x) / step);
  }
  listen(root, "pointerdown", (event) => {
    if (contact || !event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
    const button = event.target.closest("button");
    const index = button ? buttons.indexOf(button) : -1;
    if (index < 0 || button!.disabled) return;
    suppressClick = false;
    contact = { id: event.pointerId, index, x: event.clientX, y: event.clientY, lastX: event.clientX, time: event.timeStamp, drag: false };
    root.setAttribute("data-glass-sliding", ""); preview(index); animate(index);
  });
  listen(window, "pointermove", (event) => {
    if (!contact || contact.id !== event.pointerId) return;
    const dx = event.clientX - contact.x, dy = event.clientY - contact.y;
    if (!contact.drag) {
      if (Math.abs(dy) > 6 && Math.abs(dy) >= Math.abs(dx)) { cancel(); return; }
      if (Math.abs(dx) <= 6) return;
      contact.drag = true;
      root.setPointerCapture(event.pointerId);
    }
    const next = coordinate(event.clientX), step = (root.getBoundingClientRect().width - 2) / buttons.length;
    const speed = (event.clientX - contact.lastX) / step * 1000 / Math.max(8, event.timeStamp - contact.time);
    shapeTarget = reduced.matches ? 0 : Math.tanh(speed / 7) * .10;
    contact.lastX = event.clientX; contact.time = event.timeStamp; inputTime = performance.now();
    state.x = target = next; state.v = 0; preview(Math.round(next)); paint(); animate();
  }, { passive: true });
  listen(window, "pointerup", (event) => {
    if (!contact || contact.id !== event.pointerId) return;
    const { drag } = contact, next = drag ? Math.round(coordinate(event.clientX)) : contact.index;
    const box = root.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top - 24 && event.clientY <= box.bottom + 24;
    release();
    if (!inside || buttons[next].disabled) { suppressClick = true; animate(Math.max(0, selected)); return; }
    animate(next);
    if (drag) {
      suppressClick = true;
      // Use the same React onClick as tapping or the keyboard; commit once.
      buttons[next].click();
      buttons[next].focus({ preventScroll: true });
    }
  });
  listen(root, "click", (event) => {
    if (suppressClick && event.detail !== 0) {
      event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
    }
  }, { capture: true });
  listen(window, "pointercancel", (event) => { if (contact?.id === event.pointerId) cancel(); });
  // Capture transfers from the touched button to this group during a slide.
  // Its lostpointercapture bubbles; keep following the gesture on window.
  listen(root, "dragstart", (event) => event.preventDefault());
  listen(window, "blur", cancel);
  const visibility = () => { if (document.hidden) cancel(); };
  document.addEventListener("visibilitychange", visibility);
  reduced.addEventListener("change", cancel);
  root.setAttribute("data-glass-motion", ""); paint();
  return {
    update(index: number) { selected = index; if (!contact) animate(Math.max(0, index)); },
    destroy() {
      release(); cancelAnimationFrame(frame); removers.forEach((remove) => remove());
      document.removeEventListener("visibilitychange", visibility); reduced.removeEventListener("change", cancel);
      root.removeAttribute("data-glass-motion"); lens.style.removeProperty("transform"); lens.style.removeProperty("left");
    },
  };
}
