import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { syncVisualViewport } from "./viewport-sync";

class ElementStub {
  style = { top: "", bottom: "", height: "", visibility: "", transform: "" };
  offsetHeight = 86;
  isContentEditable = false;
  matches = () => false;
}
let viewport: EventTarget & { height: number; offsetTop: number; scale: number };
let surface: EventTarget & { activeElement: ElementStub | null };
let element: ElementStub;
let detach: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  surface = Object.assign(new EventTarget(), { activeElement: null as ElementStub | null });
  element = new ElementStub();
  vi.stubGlobal("HTMLElement", ElementStub);
  vi.stubGlobal("document", surface);
  vi.stubGlobal("window", Object.assign(new EventTarget(), { visualViewport: viewport, innerHeight: 844 }));
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(() => { detach?.(); detach = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("anchors the safe-area-inclusive nav to the visible bottom through toolbar changes", async () => {
  detach = syncVisualViewport(element as unknown as HTMLElement, "bottom");
  expect(element.style.top).toBe("758px");
  viewport.height = 760;
  viewport.offsetTop = 24;
  for (let i = 0; i < 10; i++) viewport.dispatchEvent(new Event("scroll"));
  await vi.advanceTimersByTimeAsync(16);
  expect(element.style.top).toBe("698px");
  expect(element.style.bottom).toBe("auto");
});

it("hides navigation while typing and restores it after keyboard dismissal", async () => {
  detach = syncVisualViewport(element as unknown as HTMLElement, "bottom");
  const input = new ElementStub();
  input.matches = () => true;
  surface.activeElement = input;
  viewport.height = 440;
  viewport.dispatchEvent(new Event("resize"));
  await vi.advanceTimersByTimeAsync(16);
  expect(element.style.visibility).toBe("hidden");
  surface.activeElement = null;
  viewport.height = 844;
  surface.dispatchEvent(new Event("focusout"));
  viewport.dispatchEvent(new Event("resize"));
  await vi.advanceTimersByTimeAsync(16);
  expect(element.style.top).toBe("758px");
  expect(element.style.visibility).toBe("");
});

it("fits modal without overriding its animation transform; handles cleanup and reopen", async () => {
  element.style.transform = "translateX(12px)";
  viewport.height = 420;
  viewport.offsetTop = 100;
  detach = syncVisualViewport(element as unknown as HTMLElement, "full");
  expect(element.style.height).toBe("420px");
  expect(element.style.top).toBe("100px");
  expect(element.style.transform).toBe("translateX(12px)");
  viewport.dispatchEvent(new Event("resize"));
  detach();
  await vi.advanceTimersByTimeAsync(16);
  expect(element.style.height).toBe("");
  detach = syncVisualViewport(element as unknown as HTMLElement, "full");
  expect(element.style.height).toBe("420px");
});

it("does not chase pinch zoom and resyncs after returning to normal scale", async () => {
  detach = syncVisualViewport(element as unknown as HTMLElement, "bottom");
  viewport.scale = 2;
  viewport.height = 422;
  viewport.dispatchEvent(new Event("resize"));
  await vi.advanceTimersByTimeAsync(16);
  expect(element.style.top).toBe("758px");
  viewport.scale = 1;
  viewport.height = 800;
  viewport.dispatchEvent(new Event("resize"));
  await vi.advanceTimersByTimeAsync(16);
  expect(element.style.top).toBe("714px");
});
