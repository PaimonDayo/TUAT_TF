/* eslint-disable @next/next/no-img-element */
export type NoteImage = { id: string; path: string };
export function NoteImages({ images = [] }: { images?: NoteImage[] }) {
  if (!images.length) return null;
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {images.map((image, index) => (
        <a
          key={image.id}
          href={`/api/note-image?id=${image.id}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`写真${index + 1}を拡大`}
        >
          <img
            src={`/api/note-image?id=${image.id}`}
            alt={`添付写真${index + 1}`}
            loading="lazy"
            className="aspect-square w-full rounded-xl object-cover"
          />
        </a>
      ))}
    </div>
  );
}
