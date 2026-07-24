import { describe, expect, it, vi } from "vitest";
import {
  encodeAvatarCanvas,
  avatarStoragePathFromPublicUrl,
  calculateAvatarCrop,
  calculateSquareCrop,
} from "@/lib/avatar-image";

describe("avatar image helpers", () => {
  it("uses WebP when the browser can encode it", async () => {
    const webp = new Blob(["webp"], { type: "image/webp" });
    const canvas = {
      toBlob: vi.fn((callback: BlobCallback) => callback(webp)),
    } as unknown as HTMLCanvasElement;
    const createCanvas = vi.fn();

    await expect(encodeAvatarCanvas(canvas, createCanvas)).resolves.toBe(webp);
    expect(createCanvas).not.toHaveBeenCalled();
  });

  it("falls back to JPEG when Safari cannot encode WebP", async () => {
    const jpeg = new Blob(["jpeg"], { type: "image/jpeg" });
    const sourceCanvas = {
      width: 512,
      height: 512,
      toBlob: vi.fn((callback: BlobCallback) =>
        callback(new Blob(["png"], { type: "image/png" })),
      ),
    } as unknown as HTMLCanvasElement;
    const context = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    };
    const jpegCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback) => callback(jpeg)),
    } as unknown as HTMLCanvasElement;

    await expect(
      encodeAvatarCanvas(sourceCanvas, () => jpegCanvas),
    ).resolves.toBe(jpeg);
    expect(jpegCanvas.width).toBe(512);
    expect(jpegCanvas.height).toBe(512);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 512, 512);
    expect(context.drawImage).toHaveBeenCalledWith(sourceCanvas, 0, 0);
  });

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

  it("zooms into the selected square", () => {
    expect(
      calculateAvatarCrop(1600, 1200, {
        viewportSize: 300,
        zoom: 2,
        offsetX: 0,
        offsetY: 0,
      }),
    ).toEqual({
      sourceX: 500,
      sourceY: 300,
      sourceSize: 600,
    });
  });

  it("moves the crop opposite to the displayed image offset", () => {
    expect(
      calculateAvatarCrop(1600, 1200, {
        viewportSize: 300,
        zoom: 2,
        offsetX: 50,
        offsetY: -25,
      }),
    ).toEqual({
      sourceX: 400,
      sourceY: 350,
      sourceSize: 600,
    });
  });

  it("clamps a moved crop to the image edge", () => {
    expect(
      calculateAvatarCrop(1600, 1200, {
        viewportSize: 300,
        zoom: 2,
        offsetX: 10_000,
        offsetY: -10_000,
      }),
    ).toEqual({
      sourceX: 0,
      sourceY: 600,
      sourceSize: 600,
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
