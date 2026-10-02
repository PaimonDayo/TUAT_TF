import { attachGlassInteraction } from "./glass-interaction";

/** The browser composites the live backdrop; only the selection needs JS. */
export function mountGlass(nav: HTMLElement, selected: number) {
  const bar = nav.querySelector<HTMLElement>(".glass-bar")!;
  return attachGlassInteraction(bar, selected);
}
