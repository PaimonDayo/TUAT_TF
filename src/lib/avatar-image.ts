export const AVATAR_BUCKET = "avatars";
export const AVATAR_OUTPUT_SIZE = 512;
export const AVATAR_MAX_INPUT_BYTES = 12 * 1024 * 1024;
export const AVATAR_MAX_PIXELS = 50_000_000;
const AVATAR_INPUT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

export type SquareCrop = {
  sourceX: number;
  sourceY: number;
  sourceSize: number;
};

export type AvatarCropTransform = {
  viewportSize: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
};

export function calculateSquareCrop(width: number, height: number): SquareCrop {
  const sourceSize = Math.min(width, height);
  return {
    sourceX: (width - sourceSize) / 2,
    sourceY: (height - sourceSize) / 2,
    sourceSize,
  };
}

export function calculateAvatarCrop(
  width: number,
  height: number,
  transform?: AvatarCropTransform,
): SquareCrop {
  if (!transform) return calculateSquareCrop(width, height);

  const viewportSize = Math.max(1, transform.viewportSize);
  const zoom = Math.max(1, transform.zoom);
  const baseScale = Math.max(viewportSize / width, viewportSize / height);
  const sourceSize = Math.min(
    width,
    height,
    viewportSize / (baseScale * zoom),
  );
  const sourcePixelsPerViewportPixel = sourceSize / viewportSize;
  const centerX =
    width / 2 - transform.offsetX * sourcePixelsPerViewportPixel;
  const centerY =
    height / 2 - transform.offsetY * sourcePixelsPerViewportPixel;

  return {
    sourceX: Math.min(
      width - sourceSize,
      Math.max(0, centerX - sourceSize / 2),
    ),
    sourceY: Math.min(
      height - sourceSize,
      Math.max(0, centerY - sourceSize / 2),
    ),
    sourceSize,
  };
}

export function validateAvatarFile(file: File): void {
  if (!AVATAR_INPUT_TYPES.has(file.type.toLowerCase())) {
    throw new Error("JPG・PNG・WebP・HEICの画像を選んでください");
  }
  if (file.size > AVATAR_MAX_INPUT_BYTES) {
    throw new Error("画像は12MB以下のものを選んでください");
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: "image/webp" | "image/jpeg",
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(
        (blob) => {
          resolve(blob?.type === type ? blob : null);
        },
        type,
        quality,
      );
    } catch {
      resolve(null);
    }
  });
}

export async function encodeAvatarCanvas(
  canvas: HTMLCanvasElement,
  createCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): Promise<Blob> {
  const webp = await canvasToBlob(canvas, "image/webp", 0.82);
  if (webp) return webp;

  const jpegCanvas = createCanvas();
  jpegCanvas.width = canvas.width;
  jpegCanvas.height = canvas.height;
  const context = jpegCanvas.getContext("2d");
  if (!context) throw new Error("画像を変換できませんでした");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, jpegCanvas.width, jpegCanvas.height);
  context.drawImage(canvas, 0, 0);

  const jpeg = await canvasToBlob(jpegCanvas, "image/jpeg", 0.86);
  if (jpeg) return jpeg;
  throw new Error("この端末では画像を変換できませんでした");
}

/** 選択範囲を正方形に切り抜き、EXIFを含まない512px画像へ変換する。 */
export async function prepareAvatarImage(
  file: File,
  transform?: AvatarCropTransform,
): Promise<Blob> {
  validateAvatarFile(file);

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("画像を読み込めませんでした"));
      image.src = objectUrl;
    });

    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height || width * height > AVATAR_MAX_PIXELS) {
      throw new Error("画像の解像度が大きすぎます");
    }

    const canvas = document.createElement("canvas");
    canvas.width = AVATAR_OUTPUT_SIZE;
    canvas.height = AVATAR_OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像を変換できませんでした");

    const crop = calculateAvatarCrop(width, height, transform);
    context.drawImage(
      image,
      crop.sourceX,
      crop.sourceY,
      crop.sourceSize,
      crop.sourceSize,
      0,
      0,
      AVATAR_OUTPUT_SIZE,
      AVATAR_OUTPUT_SIZE,
    );
    return encodeAvatarCanvas(canvas);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function isSafeAvatarStoragePath(path: string): boolean {
  const segments = path.split("/");
  return (
    segments.length === 2 &&
    /^[A-Za-z0-9_-]+$/.test(segments[0]) &&
    /^[A-Za-z0-9_-]+\.(?:webp|jpe?g)$/i.test(segments[1])
  );
}

export function avatarStoragePathFromUrl(
  avatarUrl: string | null | undefined,
  supabaseUrl: string,
): string | null {
  if (!avatarUrl) return null;
  if (isSafeAvatarStoragePath(avatarUrl)) return avatarUrl;

  try {
    const avatar = new URL(avatarUrl);
    const project = new URL(supabaseUrl);
    const prefix = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
    if (avatar.origin !== project.origin || !avatar.pathname.startsWith(prefix)) return null;
    const path = decodeURIComponent(avatar.pathname.slice(prefix.length));
    return isSafeAvatarStoragePath(path) ? path : null;
  } catch {
    return null;
  }
}

export function avatarDisplayUrl(
  avatarUrl: string | null | undefined,
): string | null {
  if (!avatarUrl) return null;
  return isSafeAvatarStoragePath(avatarUrl)
    ? `/api/avatar/image?path=${encodeURIComponent(avatarUrl)}`
    : avatarUrl;
}

export function avatarStoragePathFromPublicUrl(
  avatarUrl: string | null | undefined,
  supabaseUrl: string,
  userId: string,
): string | null {
  const path = avatarStoragePathFromUrl(avatarUrl, supabaseUrl);
  return path?.startsWith(`${userId}/`) ? path : null;
}
