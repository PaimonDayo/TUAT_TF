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
  query.select.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.delete.mockReturnValue(query);
  query.limit.mockResolvedValue({
    data: [{ path: "article/image.webp" }],
    error: null,
  });
  query.in.mockResolvedValue({ error: null });
});
it("retains the durable queue when R2 removal fails", async () => {
  mocks.remove.mockRejectedValue(new Error("offline"));
  await expect(cleanupNoteImages()).rejects.toThrow("offline");
  expect(query.delete).not.toHaveBeenCalled();
});
it("acknowledges queue entries only after successful R2 removal", async () => {
  mocks.remove.mockResolvedValue(undefined);
  expect(await cleanupNoteImages()).toBe(1);
  expect(query.in).toHaveBeenCalledWith("path", ["article/image.webp"]);
  expect(mocks.remove.mock.invocationCallOrder[0]).toBeLessThan(
    query.delete.mock.invocationCallOrder[0],
  );
});
