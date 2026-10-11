const GAP = 8;
const MARGIN = 8;

export interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
}
export interface Size {
  width: number;
  height: number;
}

/**
 * Place a tooltip below the anchor, flipping above / clamping horizontally to stay in view.
 * All coordinates are viewport-relative.
 */
export function computePosition(anchor: AnchorRect, size: Size, viewport: Size): { top: number; left: number } {
  let top = anchor.bottom + GAP;
  if (top + size.height > viewport.height - MARGIN) {
    top = Math.max(MARGIN, anchor.top - GAP - size.height);
  }
  const maxLeft = viewport.width - size.width - MARGIN;
  const left = Math.min(Math.max(MARGIN, anchor.left), Math.max(MARGIN, maxLeft));
  return { top, left };
}
