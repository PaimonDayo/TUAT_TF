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

export function calculateSquareCrop(width: number, height: number): SquareCrop {
  const sourceSize = Math.min(width, height);
  return {
    sourceX: (width - sourceSize) / 2,
    sourceY: (height - sourceSize) / 2,
    sourceSize,
  };
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== "image/webp") {
          reject(new Error("この端末では画像を変換できませんでした"));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      quality,
    );
  });
}

/** 選択画像の中央を正方形に切り抜き、EXIFを含まない512px WebPへ変換する。 */
export async function prepareAvatarImage(file: File): Promise<Blob> {
  if (!AVATAR_INPUT_TYPES.has(file.type.toLowerCase())) {
    throw new Error("JPG・PNG・WebPの画像を選んでください");
  }
  if (file.size > AVATAR_MAX_INPUT_BYTES) {
    throw new Error("画像は12MB以下のものを選んでください");
  }

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

    const crop = calculateSquareCrop(width, height);
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
    return canvasToWebp(canvas, 0.82);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function avatarStoragePathFromPublicUrl(
  avatarUrl: string | null | undefined,
  supabaseUrl: string,
  userId: string,
): string | null {
  if (!avatarUrl) return null;
  try {
    const avatar = new URL(avatarUrl);
    const project = new URL(supabaseUrl);
    const prefix = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
    if (avatar.origin !== project.origin || !avatar.pathname.startsWith(prefix)) return null;
    const path = decodeURIComponent(avatar.pathname.slice(prefix.length));
    return path.startsWith(`${userId}/`) ? path : null;
  } catch {
    return null;
  }
}