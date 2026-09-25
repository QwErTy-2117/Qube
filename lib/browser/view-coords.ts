/**
 * Client→page coordinate mapping for the live browser view.
 *
 * The panel renders the managed browser's screencast JPEG with
 * object-fit:contain, so the image may be letterboxed inside its box. Panel
 * clicks/wheel must map back to page CSS pixels (what CDP Input expects),
 * using the viewport metrics the screencast reports — never the JPEG's own
 * pixel size (screenshots are downscaled to 1280px wide).
 */

export type PageViewport = {
  deviceWidth: number;
  deviceHeight: number;
};

export type Box = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function mapToPage(
  clientX: number,
  clientY: number,
  box: Box,
  meta: PageViewport | null | undefined
): { x: number; y: number } | null {
  if (!meta || !Number.isFinite(meta.deviceWidth) || !Number.isFinite(meta.deviceHeight)) {
    return null;
  }
  if (meta.deviceWidth <= 0 || meta.deviceHeight <= 0) return null;
  if (!Number.isFinite(box.width) || !Number.isFinite(box.height)) return null;
  if (box.width <= 0 || box.height <= 0) return null;
  // Contain-fit: uniform scale + centered bars, mirroring the <img> render.
  const scale = Math.min(box.width / meta.deviceWidth, box.height / meta.deviceHeight);
  if (!(scale > 0)) return null;
  const drawnW = meta.deviceWidth * scale;
  const drawnH = meta.deviceHeight * scale;
  const offX = box.left + (box.width - drawnW) / 2;
  const offY = box.top + (box.height - drawnH) / 2;
  return {
    x: Math.round((clientX - offX) / scale),
    y: Math.round((clientY - offY) / scale),
  };
}
