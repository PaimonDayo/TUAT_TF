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
  let contact: { kind: "touch" | "pointer"; id: number; index: number; x: number; y: number; lastX: number; started: number; time: number; drag: boolean } | null = null;
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
    const id = contact?.kind === "pointer" ? contact.id : undefined;
    contact = null; shapeTarget = 0;
    root.removeAttribute("data-glass-sliding"); preview(-1);
    if (id !== undefined && root.hasPointerCapture(id)) root.releasePointerCapture(id);
  }
  function cancel() {
    if (contact) suppressClick = true;
    release(); animate(Math.max(0, selected));
  }
  function coordinate(x: number) {
    const step = (root.getBoundingClientRect().width - 2) / buttons.length;
    return clamp(contact!.index + (x - contact!.x) / step);
  }
  function begin(kind: "touch" | "pointer", id: number, x: number, y: number, time: number, element: EventTarget | null) {
    if (contact || !(element instanceof Element)) return;
    const button = element.closest("button");
    const index = button ? buttons.indexOf(button) : -1;
    if (index < 0 || button!.disabled) return;
    suppressClick = false;
    root.setAttribute("data-glass-pointer-focus", "");
    contact = { kind, id, index, x, y, lastX: x, started: time, time, drag: false };
    root.setAttribute("data-glass-sliding", ""); preview(index); animate(index);
  }
  function move(x: number, y: number, time: number) {
    if (!contact) return;
    const dx = x - contact.x, dy = y - contact.y;
    if (!contact.drag) {
      // A deliberate hold owns the slide, including ordinary finger tremor.
      // A vertical swipe started promptly still scrolls the page natively.
      const held = time - contact.started >= 300;
      if (!held && Math.abs(dy) > 6 && Math.abs(dy) >= Math.abs(dx)) { cancel(); return; }
      if ((held ? Math.hypot(dx, dy) : Math.abs(dx)) <= 6) return;
      contact.drag = true;
      if (contact.kind === "pointer") root.setPointerCapture(contact.id);
    }
    const next = coordinate(x), step = (root.getBoundingClientRect().width - 2) / buttons.length;
    const speed = (x - contact.lastX) / step * 1000 / Math.max(8, time - contact.time);
    shapeTarget = reduced.matches ? 0 : Math.tanh(speed / 7) * .10;
    contact.lastX = x; contact.time = time; inputTime = performance.now();
    state.x = target = next; state.v = 0; preview(Math.round(next)); paint(); animate();
  }
  function finish(x: number, y: number) {
    if (!contact) return;
    const { kind, drag } = contact, next = drag ? Math.round(coordinate(x)) : contact.index;
    const box = root.getBoundingClientRect();
    // Match the bottom tabs' release tolerance after a slide; leaving the
    // control slightly while lifting a finger must not undo the selection.
    const marginX = drag ? 45 : 0, marginY = drag ? 70 : 24;
    const inside = x >= box.left - marginX && x <= box.right + marginX && y >= box.top - marginY && y <= box.bottom + marginY;
    release();
    if (!inside || buttons[next].disabled) { suppressClick = true; animate(Math.max(0, selected)); return; }
    animate(next);
    if (drag || kind === "touch") {
      suppressClick = true;
      // Use the same React onClick as tapping or the keyboard; commit once.
      buttons[next].click();
      // Keep the keyboard's next Tab relative to the selected button, but don't
      // let synthetic touch activation inherit a keyboard-only focus ring.
      root.setAttribute("data-glass-pointer-focus", "");
      buttons[next].focus({ preventScroll: true });
    }
  }
  const clearPointerFocus = () => root.removeAttribute("data-glass-pointer-focus");
  // Safari may leave a clicked button unfocused, so the first Tab can arrive
  // from outside this group. Clear before that key's default focus movement.
  listen(window, "keydown", clearPointerFocus, { capture: true });
  listen(root, "focusout", (event) => {
    if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget)) clearPointerFocus();
  });
  // Safari can cancel the Pointer stream while the physical touch continues.
  // As with BottomNav, follow Touch.identifier until that finger ends instead.
  const touchEvents = "ontouchstart" in window;
  listen(root, "touchstart", (event) => {
    if (event.touches.length !== 1) { cancel(); return; }
    const touch = event.changedTouches[0];
    if (touch) begin("touch", touch.identifier, touch.clientX, touch.clientY, event.timeStamp, touch.target);
  }, { passive: true });
  listen(window, "touchstart", (event) => {
    if (contact?.kind === "touch" && event.touches.length > 1) cancel();
  }, { passive: true });
  // Touch events keep their original target even outside the control. Keep
  // non-passive listeners local so the rest of the page scrolls without them.
  listen(root, "touchmove", (event) => {
    if (contact?.kind !== "touch") return;
    if (event.touches.length !== 1) { cancel(); return; }
    const touch = Array.from(event.changedTouches).find((touch) => touch.identifier === contact?.id);
    if (!touch) return;
    move(touch.clientX, touch.clientY, event.timeStamp);
    if (contact?.drag && event.cancelable) event.preventDefault();
  }, { passive: false });
  listen(root, "touchend", (event) => {
    if (contact?.kind !== "touch") return;
    const touch = Array.from(event.changedTouches).find((touch) => touch.identifier === contact?.id);
    if (!touch) return;
    if (event.cancelable) event.preventDefault();
    finish(touch.clientX, touch.clientY);
  }, { passive: false });
  listen(root, "touchcancel", (event) => {
    if (contact?.kind === "touch" && Array.from(event.changedTouches).some((touch) => touch.identifier === contact?.id)) cancel();
  });
  listen(root, "pointerdown", (event) => {
    if ((event.pointerType === "touch" && touchEvents) || !event.isPrimary || event.button !== 0) return;
    begin("pointer", event.pointerId, event.clientX, event.clientY, event.timeStamp, event.target);
  });
  listen(window, "pointermove", (event) => {
    if (contact?.kind === "pointer" && contact.id === event.pointerId) move(event.clientX, event.clientY, event.timeStamp);
  }, { passive: true });
  listen(window, "pointerup", (event) => {
    if (contact?.kind === "pointer" && contact.id === event.pointerId) finish(event.clientX, event.clientY);
  });
  listen(root, "click", (event) => {
    if (suppressClick && (event.detail !== 0 || (event instanceof PointerEvent && event.pointerType === "touch"))) {
      event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false;
    }
  }, { capture: true });
  listen(window, "pointercancel", (event) => { if (contact?.kind === "pointer" && contact.id === event.pointerId) cancel(); });
  // Capture transfers from the touched button to this group during a slide.
  // Its lostpointercapture bubbles; keep following the gesture on window.
  listen(root, "dragstart", (event) => event.preventDefault());
  listen(root, "contextmenu", (event) => event.preventDefault());
  listen(window, "blur", cancel);
  const visibility = () => { if (document.hidden) cancel(); };
  document.addEventListener("visibilitychange", visibility);
  reduced.addEventListener("change", cancel);
  root.setAttribute("data-glass-motion", ""); paint();
  return {
    update(index: number) { selected = index; if (!contact) animate(Math.max(0, index)); },
    destroy() {
      release(); cancelAnimationFrame(frame); removers.forEach((remove) => remove());
      clearPointerFocus();
      document.removeEventListener("visibilitychange", visibility); reduced.removeEventListener("change", cancel);
      root.removeAttribute("data-glass-motion"); lens.style.removeProperty("transform"); lens.style.removeProperty("left");
    },
  };
}
