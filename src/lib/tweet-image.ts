export const TWEET_IMAGE_BUCKET = "tweet-images";
export const TWEET_IMAGE_MAX_INPUT_BYTES = 12 * 1024 * 1024;
const MAX_SIDE = 1600;
const MAX_PIXELS = 50_000_000;
const INPUT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isSafeTweetImagePath(path: string) {
  return /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i.test(path);
}

export function tweetImageDisplayUrl(path: string) {
  return `/api/tweet-image?path=${encodeURIComponent(path)}`;
}

export function validateTweetImage(file: File) {
  if (!INPUT_TYPES.has(file.type.toLowerCase())) {
    throw new Error("JPG・PNG・WebPの画像を選んでください");
  }
  if (file.size > TWEET_IMAGE_MAX_INPUT_BYTES) {
    throw new Error("画像は12MB以下のものを選んでください");
  }
}

export async function prepareTweetImage(file: File): Promise<Blob> {
  validateTweetImage(file);
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
    if (!width || !height || width * height > MAX_PIXELS) {
      throw new Error("画像の解像度が大きすぎます");
    }
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像を変換できませんでした");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.82);
    });
    if (!blob || blob.size > 5 * 1024 * 1024) {
      throw new Error("画像を圧縮できませんでした。別の画像をお試しください");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}