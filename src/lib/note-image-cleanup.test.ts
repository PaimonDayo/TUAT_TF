import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ admin: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/image-storage", () => ({ removeImages: mocks.remove }));
import { cleanupNoteImages } from "@/lib/note-image-cleanup";
const query = {
  select: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  delete: vi.fn(),
  in: vi.fn(),
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockReturnValue({ from: () => query });
  query.select.mockResolvedValue({ count: 2, error: null });
  query.order.mockReturnValue(query);
  query.delete.mockReturnValue(query);
  query.limit.mockResolvedValue({
    data: [{ path: "article/image.webp" }],
    error: null,
  });
  query.in.mockResolvedValue({ error: null });
});
it("retains legacy queue rows and objects because their insert outcome is unknown", async () => {
  const diagnostic = vi.spyOn(console, "info").mockImplementation(() => undefined);
  try {
    expect(await cleanupNoteImages()).toBe(0);
    expect(query.select).toHaveBeenCalledWith("*", { count: "exact", head: true });
    expect(diagnostic).toHaveBeenCalledWith("Note image cleanup deferred", { queued: 2 });
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(query.delete).not.toHaveBeenCalled();
  } finally { diagnostic.mockRestore(); }
});
it("does not delete anything when queue inspection is unavailable", async () => {
  query.select.mockResolvedValue({ count: null, error: new Error("offline") });
  await expect(cleanupNoteImages()).rejects.toThrow("offline");
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(query.delete).not.toHaveBeenCalled();
});
