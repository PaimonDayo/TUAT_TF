import { attachGlassInteraction } from "./glass-interaction";

let vendor: Promise<void> | undefined;
function loadVendor() {
  if (customElements.get("liquid-glass")) return Promise.resolve();
  if (!vendor) vendor = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/liquid-glass/simple-liquid-glass.js?v=9";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); vendor = undefined; reject(new Error("Glass unavailable")); };
    document.head.append(script);
  });
  return vendor;
}

/** Owned by one mounted BottomNav. All listeners, captures and GPU resources are released. */
export function mountGlass(nav: HTMLElement, selected: number, pathname: string) {
  const bar = nav.querySelector<HTMLElement>(".glass-bar")!;
  const interaction = attachGlassInteraction(bar, selected);
  const transparency = matchMedia("(prefers-reduced-transparency: reduce)");
  const contrast = matchMedia("(prefers-contrast: more)");
  let disposed = false;
  let material: HTMLElement | null = null;
  let route = pathname;
  const enabled = () => !disposed && !document.hidden && !transparency.matches && !contrast.matches;
  const sync = () => {
    if (!enabled()) { material?.remove(); material = null; return; }
    void loadVendor().then(() => {
      if (!enabled() || material) return;
      material = document.createElement("liquid-glass");
      for (const [name, value] of Object.entries({
        "aria-hidden": "true", "backdrop-selector": ".app-main", renderer: "webgl",
        "lens-profile": "player", radius: "34", strength: "0.15", dispersion: "9",
        blur: "0.65", saturation: "135", frost: "0.035", "border-color": "rgba(255,255,255,0.62)",
      })) material.setAttribute(name, value);
      bar.prepend(material);
    }).catch(() => { /* Keep the CSS backdrop fallback and Link navigation. */ });
  };
  transparency.addEventListener("change", sync);
  contrast.addEventListener("change", sync);
  document.addEventListener("visibilitychange", sync);
  sync();
  return {
    update(index: number, pathname: string) {
      interaction.update(index);
      if (pathname === route) return;
      route = pathname;
      // The old route must not remain inside the lens while its new snapshot
      // waits for navigation to settle. Keep the GPU and live CSS surface.
      document.dispatchEvent(new Event("tuat:glass-route-change"));
    },
    destroy() {
      disposed = true;
      transparency.removeEventListener("change", sync);
      contrast.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      interaction.destroy();
      material?.remove(); material = null;
    },
  };
}
