import { describe, expect, it } from "vitest";
import {
  avatarStoragePathFromPublicUrl,
  calculateSquareCrop,
} from "@/lib/avatar-image";

describe("avatar image helpers", () => {
  it("crops a landscape image from the center", () => {
    expect(calculateSquareCrop(1600, 1200)).toEqual({
      sourceX: 200,
      sourceY: 0,
      sourceSize: 1200,
    });
  });

  it("crops a portrait image from the center", () => {
    expect(calculateSquareCrop(900, 1200)).toEqual({
      sourceX: 0,
      sourceY: 150,
      sourceSize: 900,
    });
  });

  it("returns only an avatar path owned by the user", () => {
    const projectUrl = "https://example.supabase.co";
    expect(
      avatarStoragePathFromPublicUrl(
        `${projectUrl}/storage/v1/object/public/avatars/user-1/avatar.webp`,
        projectUrl,
        "user-1",
      ),
    ).toBe("user-1/avatar.webp");
    expect(
      avatarStoragePathFromPublicUrl(
        `${projectUrl}/storage/v1/object/public/avatars/user-2/avatar.webp`,
        projectUrl,
        "user-1",
      ),
    ).toBeNull();
    expect(
      avatarStoragePathFromPublicUrl(
        "https://images.example.com/avatar.webp",
        projectUrl,
        "user-1",
      ),
    ).toBeNull();
  });
});