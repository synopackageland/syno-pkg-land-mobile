/**
 * The shared back arrow: the same drawing as the UI kit's back icon. Its
 * geometry is `back-arrow.json`, a byte copy of the UI kit's
 * `src/components/app/app-layout/back-arrow.json`; both repositories pin the
 * file's SHA-256 in a test, so changing one without the other fails there.
 * React Native has no SVG here, so each stroke is drawn as a rounded bar.
 * (The JSON is imported by the screens: Node's test runner needs an import
 * attribute for JSON that Metro does not take.)
 */
export type BackArrow = { name: string; size: number; stroke: number; lines: number[][] };

/** The SVG path of the arrow, as the UI kit draws it */
export function backArrowPath(arrow: BackArrow): string {
  return arrow.lines.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join('');
}

/**
 * One stroke with round caps, as a box rotated about its centre: `left`, `top`,
 * `width` and `height` place the unrotated box; `rotate` is in degrees.
 */
export type StrokeBox = { left: number; top: number; width: number; height: number; radius: number; rotate: number };
/** The arrow's strokes drawn at `size` px with a stroke of `stroke` px (the drawing's own width scaled, by default) */
export function backArrowStrokes(size: number, arrow: BackArrow, stroke = arrow.stroke * size / arrow.size): StrokeBox[] {
  const scale = size / arrow.size;
  return arrow.lines.map(([x1, y1, x2, y2]) => {
    const length = Math.hypot(x2 - x1, y2 - y1) * scale;
    const cx = (x1 + x2) / 2 * scale, cy = (y1 + y2) / 2 * scale;
    // A round cap adds half the stroke at each end
    const width = length + stroke;
    return { left: cx - width / 2, top: cy - stroke / 2, width, height: stroke, radius: stroke / 2, rotate: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI };
  });
}
