"use client";

import {
  FileTextIcon,
  FileArchiveIcon,
  FileIcon,
  PresentationIcon,
  TableIcon,
  ImageIcon,
  MusicIcon,
  VideoIcon,
  SquareArrowOutUpRightIcon,
} from "lucide-react";
import { openDocumentWorkspace } from "@/lib/workspace/store";
import { isPptxFile } from "@/lib/workspace/pptx";
import { DownloadButton } from "./download-button";
import { PresentationFileCard } from "./presentation-card";
import { cn } from "@/lib/utils";

const OPENABLE = new Set([
  // documents
  "doc", "docx", "odt", "rtf", "txt", "md", "markdown",
  // spreadsheets
  "xls", "xlsx", "ods", "csv", "tsv",
  // presentations
  "ppt", "pptx", "odp",
  // code
  "json", "js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "css", "html", "yml", "yaml", "toml", "sh", "sql", "xml", "log",
]);
// NOTE: images, pdfs, audio/video/archives are download-only. Presentations
// open in the popup viewer; .pptx decks also get real thumbnail previews.

type CardKind = "slides" | "pdf" | "doc" | "sheet" | "image" | "audio" | "video" | "archive" | "generic";

type KindMeta = {
  kind: CardKind;
  icon: typeof FileIcon;
  iconClass: string;
};

function metaForExt(ext: string): KindMeta {
  if (ext === "ppt" || ext === "pptx" || ext === "odp" || ext === "key")
    return { kind: "slides", icon: PresentationIcon, iconClass: "text-orange-600 dark:text-orange-400" };
  if (ext === "pdf")
    return { kind: "pdf", icon: FileTextIcon, iconClass: "text-red-600 dark:text-red-400" };
  if (["doc", "docx", "odt", "rtf", "md", "markdown", "txt"].includes(ext))
    return { kind: "doc", icon: FileTextIcon, iconClass: "text-blue-600 dark:text-blue-400" };
  if (["xls", "xlsx", "ods", "csv", "tsv"].includes(ext))
    return { kind: "sheet", icon: TableIcon, iconClass: "text-emerald-600 dark:text-emerald-400" };
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif"].includes(ext))
    return { kind: "image", icon: ImageIcon, iconClass: "text-sky-600 dark:text-sky-400" };
  if (["mp3", "wav", "ogg", "flac", "m4a"].includes(ext))
    return { kind: "audio", icon: MusicIcon, iconClass: "text-violet-600 dark:text-violet-400" };
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext))
    return { kind: "video", icon: VideoIcon, iconClass: "text-fuchsia-600 dark:text-fuchsia-400" };
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext))
    return { kind: "archive", icon: FileArchiveIcon, iconClass: "text-amber-600 dark:text-amber-400" };
  return { kind: "generic", icon: FileIcon, iconClass: "text-muted-foreground" };
}

export function FileCard({
  filename,
  filePath,
  downloadUrl,
}: {
  filename: string;
  filePath?: string;
  downloadUrl: string;
}) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const canOpen = OPENABLE.has(ext) && !!filePath;

  const handleOpen = () => {
    if (!filePath) return;
    openDocumentWorkspace({ filePath, filename, downloadUrl });
  };

  // PowerPoint decks get a real slide preview card instead of the generic
  // pill. Clicking any thumbnail opens the popup at that exact slide.
  if (isPptxFile(filename) && filePath) {
    return <PresentationFileCard filename={filename} filePath={filePath} downloadUrl={downloadUrl} />;
  }

  // Single slim pill for every other file type (full-width, rounded borders).
  // Per-type colored icons are kept; only the bulky rich tile is gone.
  const meta = metaForExt(ext);
  const Icon = meta.icon;
  return (
    <span
      className="flex w-full items-center gap-2 rounded-full border border-border/70 bg-background py-1 pr-1 pl-3 text-sm shadow-xs"
      title={filename}
    >
      <Icon className={cn("size-4 shrink-0", meta.iconClass)} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{filename}</span>
      <span className="flex shrink-0 items-center">
        {canOpen && (
          <button
            onClick={handleOpen}
            title="Open"
            aria-label={`Open ${filename}`}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <SquareArrowOutUpRightIcon className="size-4" />
          </button>
        )}
        <DownloadButton filename={filename} downloadUrl={downloadUrl} />
      </span>
    </span>
  );
}
