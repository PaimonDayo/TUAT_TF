/* eslint-disable @next/next/no-img-element */
import { Linkify } from "@/components/common/Linkify";
import { NoteImages, type NoteImage } from "@/components/features/NoteImages";
import { parseNoteBody, photoKeyFromPath } from "@/lib/note-body";

/**
 * 記事の本文。写真は本文で置いた位置にそのまま出す。
 * 位置を決めていない写真（この機能より前に付けた分など）は、今までどおり本文の後ろへ並べる。
 */
export function NoteBody({
  body,
  images = [],
  className = "text-[15px] leading-7",
}: {
  body: string;
  images?: NoteImage[];
  className?: string;
}) {
  const byKey = new Map<string, NoteImage>();
  for (const image of images) {
    const key = photoKeyFromPath(image.path);
    if (key) byKey.set(key, image);
  }

  const blocks = parseNoteBody(body);
  const placed = new Set<string>();
  for (const block of blocks) {
    if (block.type === "photo" && byKey.has(block.key)) placed.add(block.key);
  }
  const unplaced = images.filter((image) => {
    const key = photoKeyFromPath(image.path);
    return !key || !placed.has(key);
  });

  return (
    <div className="min-w-0">
      {blocks.map((block, index) => {
        if (block.type === "text") {
          if (!block.text) return null;
          return (
            <p
              key={index}
              className={`whitespace-pre-wrap break-words ${className}`}
            >
              <Linkify text={block.text} />
            </p>
          );
        }
        const image = byKey.get(block.key);
        if (!image) return null;
        return (
          <a
            key={index}
            href={`/api/note-image?id=${image.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="my-3 block"
            aria-label="写真を拡大"
          >
            <img
              src={`/api/note-image?id=${image.id}`}
              alt="本文の写真"
              loading="lazy"
              className="w-full rounded-xl object-contain"
            />
          </a>
        );
      })}
      <NoteImages images={unplaced} />
    </div>
  );
}
