let lastControl: HTMLElement | null = null;

/** Safari doesn't focus clicked buttons. Remember the actual opener as well as
 * keyboard focus so closing a portal can return to the control that opened it. */
export function glassDialogOpener(): HTMLElement | null {
  return lastControl?.isConnected ? lastControl
    : document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

/** Immediate touch feedback even where :active is deferred until release. */
export function attachGlassPress() {
  const remember = (event: Event) => {
    if (event.target instanceof Element) {
      lastControl = event.target.closest<HTMLElement>("button,a[href],input,select,textarea,[role='button'],[role='switch'],[tabindex]");
    }
  };
  let pressed: { node: HTMLElement; id: number; x: number; y: number } | null = null;
  const clear = () => {
    pressed?.node.removeAttribute("data-glass-pressed");
    pressed = null;
  };
  const down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
    remember(event);
    const node = event.target.closest<HTMLElement>("[data-glass-control],.app-create-button,.system-glass-menu-item,[data-glass-segments]>button,[data-ui-action],[data-ui-reaction],[data-ui-choice],[data-ui-row],[data-ui-disclosure]");
    if (!node || node.matches(":disabled")) return;
    // Forms and sheets render in body portals, outside .app-main. Their controls
    // carry the same effective-role flag as their selection surface.
    const enabled = node.matches("[data-system-glass][data-glass-control]")
      || node.parentElement?.matches("[data-system-glass][data-glass-segments]")
      || node.closest(".system-glass-menu")
      || node.closest("[data-new-ui-surface]")
      || node.closest(".app-main")?.querySelector(":scope > [data-new-ui]");
    if (!enabled) return;
    clear();
    pressed = { node, id: event.pointerId, x: event.clientX, y: event.clientY };
    node.setAttribute("data-glass-pressed", "");
  };
  const move = (event: PointerEvent) => {
    if (!pressed || event.pointerId !== pressed.id) return;
    const r = pressed.node.getBoundingClientRect();
    if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) > 12 || event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) clear();
  };
  const up = (event: PointerEvent) => { if (pressed?.id === event.pointerId) clear(); };
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("focusin", remember, true);
  document.addEventListener("keydown", remember, true);
  document.addEventListener("pointermove", move, { capture: true, passive: true });
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", up, true);
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", clear);
  return () => {
    clear();
    lastControl = null;
    document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("focusin", remember, true);
    document.removeEventListener("keydown", remember, true);
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerup", up, true);
    document.removeEventListener("pointercancel", up, true);
    window.removeEventListener("blur", clear);
    document.removeEventListener("visibilitychange", clear);
  };
}
