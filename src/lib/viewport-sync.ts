/** Keep fixed UI attached to the visible viewport after iOS keyboard/toolbar changes.
 * Uses top instead of transform so dialog slide animations keep working.
 * No polling, React renders or network requests are needed.
 */
export function syncVisualViewport(element: HTMLElement, edge: "bottom" | "full") {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  let frame = 0;
  const apply = () => {
    frame = 0;
    // Preserve native pinch zoom; do not chase the magnified viewport.
    if (viewport.scale !== 1) return;
    if (edge === "full") {
      element.style.top = `${viewport.offsetTop}px`;
      element.style.height = `${viewport.height}px`;
    } else {
      element.style.top = `${Math.max(0, viewport.offsetTop + viewport.height - element.offsetHeight)}px`;
      element.style.bottom = "auto";
      const focused = document.activeElement;
      const editing = focused instanceof HTMLElement &&
        (focused.matches("input, textarea, select") || focused.isContentEditable);
      element.style.visibility = editing && window.innerHeight - viewport.height > 150 ? "hidden" : "";
    }
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(apply); };
  apply();
  viewport.addEventListener("resize", schedule);
  viewport.addEventListener("scroll", schedule);
  window.addEventListener("resize", schedule);
  window.addEventListener("pageshow", schedule);
  document.addEventListener("visibilitychange", schedule);
  document.addEventListener("focusin", schedule);
  document.addEventListener("focusout", schedule);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", schedule);
    viewport.removeEventListener("scroll", schedule);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("pageshow", schedule);
    document.removeEventListener("visibilitychange", schedule);
    document.removeEventListener("focusin", schedule);
    document.removeEventListener("focusout", schedule);
    element.style.top = element.style.bottom = element.style.height = element.style.visibility = "";
  };
}
