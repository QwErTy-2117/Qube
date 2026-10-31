import JSZip from "jszip";

export type PptxMeta = {
  /** Slide width in EMU (as stored in the presentation). */
  width: number;
  /** Slide height in EMU (as stored in the presentation). */
  height: number;
  /** height / width, clamped to a sane range for layout. */
  aspectRatio: number;
  slideCount: number;
};

const DEFAULT_WIDTH = 12_192_000; // 16:9 at 96 DPI
const DEFAULT_HEIGHT = 6_858_000;

export function isPptxFile(filename: string): boolean {
  return /\.pptx$/i.test(filename.trim());
}

/**
 * Read only the presentation-level metadata needed to lay out a preview.
 * The actual slide rendering lives in the browser via pptx-preview; this
 * avoids parsing every slide twice just to learn the aspect ratio.
 */
export async function readPptxMeta(buffer: ArrayBuffer): Promise<PptxMeta> {
  const zip = await JSZip.loadAsync(buffer);
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
  const sizeTag = presentationXml?.match(/<p:sldSz\b[^>]*\/?>/)?.[0] || "";
  const width = Number(/\bcx="(\d+)"/.exec(sizeTag)?.[1]);
  const height = Number(/\bcy="(\d+)"/.exec(sizeTag)?.[1]);
  const safeWidth = Number.isFinite(width) && width > 0 ? width : DEFAULT_WIDTH;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : DEFAULT_HEIGHT;
  const aspectRatio = Math.min(2.5, Math.max(0.4, safeHeight / safeWidth));
  const slideCount = Object.keys(zip.files).filter((name) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(name),
  ).length;

  return {
    width: safeWidth,
    height: safeHeight,
    aspectRatio,
    slideCount,
  };
}
