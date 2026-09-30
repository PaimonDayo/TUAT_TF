/** Immediate touch feedback even where :active is deferred until release. */
export function attachGlassPress() {
  let pressed: { node: HTMLElement; id: number; x: number; y: number } | null = null;
  const clear = () => {
    pressed?.node.removeAttribute("data-glass-pressed");
    pressed = null;
  };
  const down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element)) return;
    const node = event.target.closest<HTMLElement>("[data-glass-control],.app-create-button,.system-glass-menu-item,[data-glass-segments]>button");
    if (!node || node.matches(":disabled") || (!node.closest(".system-glass-menu") && !node.closest(".app-main")?.querySelector(":scope > [data-system-glass-preview]"))) return;
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
  document.addEventListener("pointermove", move, { capture: true, passive: true });
  document.addEventListener("pointerup", up, true);
  document.addEventListener("pointercancel", up, true);
  window.addEventListener("blur", clear);
  document.addEventListener("visibilitychange", clear);
  return () => {
    clear();
    document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerup", up, true);
    document.removeEventListener("pointercancel", up, true);
    window.removeEventListener("blur", clear);
    document.removeEventListener("visibilitychange", clear);
  };
}
