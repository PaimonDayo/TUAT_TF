/** Keep fixed UI attached to the visible viewport after iOS keyboard/toolbar changes.
 * Uses top instead of transform so dialog slide animations keep working.
 * No polling, React renders or network requests are needed.
 */
export function syncVisualViewport(element: HTMLElement, edge: "bottom" | "full") {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  let frame = 0;
  let unobscuredHeight = Math.max(window.innerHeight, viewport.height);
  let layoutWidth = window.innerWidth;
  let keyboardHidden = false;
  const apply = () => {
    frame = 0;
    // Preserve native pinch zoom; do not chase the magnified viewport.
    if (viewport.scale !== 1) return;
    if (edge === "full") {
      element.style.top = `${viewport.offsetTop}px`;
      element.style.height = `${viewport.height}px`;
    } else {
      const focused = document.activeElement;
      const editing = focused instanceof HTMLElement &&
        (focused.matches("input, textarea, select") || focused.isContentEditable);
      // resizes-content can shrink innerHeight with the visual viewport. Keep
      // the pre-keyboard height instead of comparing two already-shrunk values.
      // A width change starts a new baseline for rotation/window resizing.
      if (layoutWidth !== window.innerWidth) {
        layoutWidth = window.innerWidth;
        unobscuredHeight = Math.max(window.innerHeight, viewport.height);
      } else {
        unobscuredHeight = Math.max(unobscuredHeight, window.innerHeight, viewport.height);
      }
      // Blur can arrive before the closing keyboard restores the viewport.
      // Keep the nav hidden through that interval and retain its normal top.
      keyboardHidden = (editing || keyboardHidden) && unobscuredHeight - viewport.height > 150;
      element.style.visibility = keyboardHidden ? "hidden" : "";
      if (!keyboardHidden) {
        element.style.top = `${Math.max(0, viewport.offsetTop + viewport.height - element.offsetHeight)}px`;
        element.style.bottom = "auto";
      }
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
