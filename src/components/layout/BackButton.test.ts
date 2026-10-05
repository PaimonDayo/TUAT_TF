import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ router: { back: vi.fn(), push: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/components/layout/glass/system-glass-state", () => ({ useSystemGlass: () => true }));
import { BackButton } from "./BackButton";

const origin = "https://app.example.invalid";
const program = origin + "/competitions/ob/program?view=operations";
let location: { href: string; origin: string };
function browser({ length = 2, referrer = "", documentUrl = program, canGoBack }: { length?: number; referrer?: string; documentUrl?: string; canGoBack?: boolean } = {}) {
  location = { href: program, origin };
  vi.stubGlobal("window", { location, history: { length }, setTimeout, ...(canGoBack !== undefined ? { navigation: { canGoBack } } : {}) });
  vi.stubGlobal("document", { referrer });
  vi.stubGlobal("performance", { getEntriesByType: () => [{ name: documentUrl }] });
}
function click(props: Parameters<typeof BackButton>[0] = {}) { BackButton(props).props.onClick(); }
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); browser(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("uses the screen fallback for a direct tab despite the initial blank history entry", () => {
  browser({ canGoBack: false }); click({ fallback: "/home" });
  expect(mocks.router.back).not.toHaveBeenCalled(); expect(mocks.router.push).toHaveBeenCalledWith("/home");
});
it("returns through known app history even when SPA navigation has no document referrer", () => {
  browser({ canGoBack: true }); click();
  expect(mocks.router.back).toHaveBeenCalledOnce(); expect(mocks.router.push).not.toHaveBeenCalled();
});
it("keeps the direct-tab fallback after its inner view is replaced", () => {
  browser({ canGoBack: false }); location.href = origin + "/competitions/ob/program?view=participant"; click();
  expect(mocks.router.back).not.toHaveBeenCalled(); expect(mocks.router.push).toHaveBeenCalledWith("/home");
});
it("does not override a known absent app entry with the referrer", () => {
  browser({ canGoBack: false, referrer: origin + "/home" }); click();
  expect(mocks.router.back).not.toHaveBeenCalled(); expect(mocks.router.push).toHaveBeenCalledWith("/home");
});
it("supports a same-origin document opener without Navigation API", () => {
  browser({ referrer: origin + "/schedule" }); click();
  expect(mocks.router.back).toHaveBeenCalledOnce(); expect(mocks.router.push).not.toHaveBeenCalled();
});
it.each(["", "https://outside.example.invalid/mail", program, "invalid-url"])("uses fallback for a directly opened document with referrer %s", referrer => {
  browser({ length: 8, referrer }); click({ fallback: "/competitions" });
  expect(mocks.router.back).not.toHaveBeenCalled(); expect(mocks.router.push).toHaveBeenCalledWith("/competitions");
});
it("keeps home to program to inner replace back working without Navigation API", () => {
  browser({ length: 3, documentUrl: origin + "/home" });
  location.href = origin + "/competitions/ob/program?view=participant"; click();
  expect(mocks.router.back).toHaveBeenCalledOnce(); expect(mocks.router.push).not.toHaveBeenCalled();
});
it("does not treat direct document query replacement as an app opener", () => {
  browser(); location.href = origin + "/competitions/ob/program?view=participant"; click();
  expect(mocks.router.back).not.toHaveBeenCalled(); expect(mocks.router.push).toHaveBeenCalledWith("/home");
});
it("keeps an explicit screen return even when an app predecessor exists", () => {
  browser({ canGoBack: true }); click({ fallback: "/competitions", forceFallback: true });
  expect(mocks.router.back).not.toHaveBeenCalled(); expect(mocks.router.push).toHaveBeenCalledWith("/competitions");
});
it("uses the existing fallback if back has no effect", () => {
  browser({ canGoBack: true }); click(); vi.advanceTimersByTime(500);
  expect(mocks.router.back).toHaveBeenCalledOnce(); expect(mocks.router.push).toHaveBeenCalledWith("/home");
});
it("does not add a second navigation after a successful back", () => {
  browser({ canGoBack: true }); click(); location.href = origin + "/schedule"; vi.advanceTimersByTime(500);
  expect(mocks.router.back).toHaveBeenCalledOnce(); expect(mocks.router.push).not.toHaveBeenCalled();
});
