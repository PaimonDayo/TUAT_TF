"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Minus, Plus, RotateCcw, X } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "@/components/ui/button";
import {
  AVATAR_MAX_PIXELS,
  prepareAvatarImage,
  validateAvatarFile,
  type AvatarCropTransform,
} from "@/lib/avatar-image";

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

type Point = { x: number; y: number };
type Position = { x: number; y: number };
type ImageMeta = { width: number; height: number };
type PinchGesture = {
  distance: number;
  zoom: number;
  position: Position;
  midpoint: Point;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clampPosition(
  position: Position,
  image: ImageMeta,
  viewportSize: number,
  zoom: number,
): Position {
  const baseScale = Math.max(
    viewportSize / image.width,
    viewportSize / image.height,
  );
  const maxX = Math.max(
    0,
    (image.width * baseScale * zoom - viewportSize) / 2,
  );
  const maxY = Math.max(
    0,
    (image.height * baseScale * zoom - viewportSize) / 2,
  );
  return {
    x: clamp(position.x, -maxX, maxX),
    y: clamp(position.y, -maxY, maxY),
  };
}

type AvatarCropEditorProps = {
  file: File | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (blob: Blob) => Promise<void> | void;
};

function avatarFileError(file: File | null): string | null {
  if (!file) return null;
  try {
    validateAvatarFile(file);
    return null;
  } catch (validationError) {
    return validationError instanceof Error
      ? validationError.message
      : "画像を読み込めませんでした";
  }
}

export function AvatarCropEditor(props: AvatarCropEditorProps) {
  const { file } = props;
  const editorKey = file
    ? `${file.name}-${file.size}-${file.lastModified}`
    : "empty";
  return <AvatarCropEditorDialog key={editorKey} {...props} />;
}

function AvatarCropEditorDialog({
  file,
  open,
  onOpenChange,
  onApply,
}: AvatarCropEditorProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const lastDragPointRef = useRef<Point | null>(null);
  const pinchRef = useRef<PinchGesture | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [image, setImage] = useState<ImageMeta | null>(null);
  const [viewportSize, setViewportSize] = useState(280);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const validationError = avatarFileError(file);
  const [error, setError] = useState<string | null>(validationError);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportSize(entry.contentRect.width);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open || !file) return;

    if (validationError) return;

    const objectUrl = URL.createObjectURL(file);
    const source = new Image();
    source.decoding = "async";
    source.onload = () => {
      if (
        !source.naturalWidth ||
        !source.naturalHeight ||
        source.naturalWidth * source.naturalHeight > AVATAR_MAX_PIXELS
      ) {
        setError("画像の解像度が大きすぎます");
        return;
      }
      setImage({ width: source.naturalWidth, height: source.naturalHeight });
      setImageUrl(objectUrl);
    };
    source.onerror = () => setError("画像を読み込めませんでした");
    source.src = objectUrl;

    return () => {
      source.onload = null;
      source.onerror = null;
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, open, validationError]);

  function updateZoom(nextZoom: number) {
    if (!image) return;
    const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    setZoom(clampedZoom);
    setPosition((current) =>
      clampPosition(current, image, viewportSize, clampedZoom),
    );
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!image || busy) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    pointersRef.current.set(event.pointerId, point);

    const points = [...pointersRef.current.values()];
    if (points.length === 1) {
      lastDragPointRef.current = point;
      pinchRef.current = null;
    } else if (points.length === 2) {
      pinchRef.current = {
        distance: Math.max(1, distance(points[0], points[1])),
        zoom,
        position,
        midpoint: midpoint(points[0], points[1]),
      };
      lastDragPointRef.current = null;
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!image || busy || !pointersRef.current.has(event.pointerId)) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    pointersRef.current.set(event.pointerId, point);
    const points = [...pointersRef.current.values()];

    if (points.length === 1 && lastDragPointRef.current) {
      const previous = lastDragPointRef.current;
      lastDragPointRef.current = point;
      setPosition((current) =>
        clampPosition(
          {
            x: current.x + point.x - previous.x,
            y: current.y + point.y - previous.y,
          },
          image,
          viewportSize,
          zoom,
        ),
      );
      return;
    }

    if (points.length === 2 && pinchRef.current) {
      const gesture = pinchRef.current;
      const currentMidpoint = midpoint(points[0], points[1]);
      const nextZoom = clamp(
        gesture.zoom * (distance(points[0], points[1]) / gesture.distance),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      const zoomRatio = nextZoom / gesture.zoom;
      const viewportCenter = viewportSize / 2;
      const nextPosition = {
        x:
          currentMidpoint.x -
          viewportCenter -
          (gesture.midpoint.x - viewportCenter - gesture.position.x) * zoomRatio,
        y:
          currentMidpoint.y -
          viewportCenter -
          (gesture.midpoint.y - viewportCenter - gesture.position.y) * zoomRatio,
      };
      setZoom(nextZoom);
      setPosition(
        clampPosition(nextPosition, image, viewportSize, nextZoom),
      );
    }
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>) {
    pointersRef.current.delete(event.pointerId);
    const points = [...pointersRef.current.values()];
    pinchRef.current = null;
    lastDragPointRef.current = points.length === 1 ? points[0] : null;
  }

  async function applyCrop() {
    if (!file || !image || busy) return;
    setBusy(true);
    setError(null);
    const transform: AvatarCropTransform = {
      viewportSize,
      zoom,
      offsetX: position.x,
      offsetY: position.y,
    };
    try {
      const prepared = await prepareAvatarImage(file, transform);
      await onApply(prepared);
      setBusy(false);
      onOpenChange(false);
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "画像を保存できませんでした。もう一度お試しください",
      );
      setBusy(false);
    }
  }

  const baseScale = image
    ? Math.max(viewportSize / image.width, viewportSize / image.height)
    : 1;
  const displayWidth = image ? image.width * baseScale * zoom : 0;
  const displayHeight = image ? image.height * baseScale * zoom : 0;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-[70] bg-black/45" />
        <Dialog.Content
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-24px)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[22px] bg-card px-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-4 shadow-xl outline-none"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <Dialog.Title className="text-title">写真の位置を調整</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[13px] text-muted">
                写真を動かして、円の中に収めてください
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="閉じる"
                disabled={busy}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted active:bg-bg disabled:opacity-40"
              >
                <X size={21} />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 flex justify-center">
            <div
              ref={viewportRef}
              role="img"
              aria-label="アイコンの切り抜き範囲。ドラッグで写真の位置を調整できます"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={finishPointer}
              onPointerCancel={finishPointer}
              className="relative aspect-square w-[min(74vw,280px)] touch-none select-none overflow-hidden rounded-xl bg-[#111]"
            >
              {imageUrl && image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute max-w-none select-none"
                  style={{
                    width: displayWidth,
                    height: displayHeight,
                    left: `calc(50% + ${position.x}px)`,
                    top: `calc(50% + ${position.y}px)`,
                    transform: "translate(-50%, -50%)",
                  }}
                />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-[13px] text-white/70">
                  {error ? "画像を表示できません" : "読み込み中…"}
                </div>
              )}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-[1px] rounded-full border-2 border-white/90 shadow-[0_0_0_999px_rgba(0,0,0,0.52)]"
              />
            </div>
          </div>

          <div className="mx-auto mt-4 max-w-[280px]">
            <div className="flex items-center gap-3">
              <Minus size={17} className="shrink-0 text-muted" aria-hidden />
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                disabled={!image || busy}
                onChange={(event) => updateZoom(Number(event.target.value))}
                aria-label="写真の拡大率"
                className="h-8 min-w-0 flex-1 accent-accent"
              />
              <Plus size={17} className="shrink-0 text-muted" aria-hidden />
            </div>
            <button
              type="button"
              disabled={!image || busy || (zoom === MIN_ZOOM && position.x === 0 && position.y === 0)}
              onClick={() => {
                setZoom(MIN_ZOOM);
                setPosition({ x: 0, y: 0 });
              }}
              className="mx-auto mt-1 flex h-9 items-center gap-1.5 px-3 text-[13px] font-semibold text-accent disabled:opacity-40"
            >
              <RotateCcw size={14} />
              中央に戻す
            </button>
          </div>

          {error && <p className="mt-2 text-center text-caption text-danger">{error}</p>}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              disabled={!image || busy}
              onClick={() => void applyCrop()}
            >
              {busy ? "保存中…" : "この写真を使う"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
