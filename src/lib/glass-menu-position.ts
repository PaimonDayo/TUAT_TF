/** Keep the surface inside the visible viewport, including the software keyboard. */
export function glassMenuPosition(
  anchor: { left: number; right: number; top: number; bottom: number },
  viewport: { left: number; top: number; width: number; height: number },
  measuredHeight: number,
) {
  const margin = 12, gap = 10;
  const width = Math.min(280, Math.max(0, viewport.width - margin * 2));
  const maxHeight = Math.max(0, viewport.height - margin * 2);
  const height = Math.min(measuredHeight, maxHeight);
  const left = Math.max(viewport.left + margin, Math.min(anchor.right - width, viewport.left + viewport.width - width - margin));
  const below = viewport.top + viewport.height - margin - anchor.bottom - gap;
  const above = anchor.top - viewport.top - margin - gap;
  const opensAbove = below < height && above > below;
  const desiredTop = opensAbove ? anchor.top - gap - height : anchor.bottom + gap;
  const top = Math.max(viewport.top + margin, Math.min(desiredTop, viewport.top + viewport.height - margin - height));
  const originX = Math.max(0, Math.min(width, (anchor.left + anchor.right) / 2 - left));
  return { left, top, width, maxHeight, origin: `${originX}px ${opensAbove ? "100%" : "0%"}` };
}
