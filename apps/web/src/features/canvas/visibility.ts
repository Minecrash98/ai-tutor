export interface RectLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const RUNTIME_VISIBILITY_MARGIN = 320;

export function isRectNearViewport(
  rect: RectLike,
  viewport: RectLike,
  margin = RUNTIME_VISIBILITY_MARGIN,
): boolean {
  if (margin < 0) {
    throw new Error("Visibility margin cannot be negative.");
  }

  const viewportLeft = viewport.x - margin;
  const viewportTop = viewport.y - margin;
  const viewportRight = viewport.x + viewport.width + margin;
  const viewportBottom = viewport.y + viewport.height + margin;
  const rectRight = rect.x + rect.width;
  const rectBottom = rect.y + rect.height;

  return (
    rectRight >= viewportLeft &&
    rect.x <= viewportRight &&
    rectBottom >= viewportTop &&
    rect.y <= viewportBottom
  );
}
