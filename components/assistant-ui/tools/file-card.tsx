"use client";

import {
  FileArchiveIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  PresentationIcon,
  TableIcon,
  SquareArrowOutUpRightIcon,
  VideoIcon,
} from "lucide-react";
import { openDocumentWorkspace } from "@/lib/workspace/store";
import { detectArtifactKind, type ArtifactKind } from "@/lib/artifact/kinds";
import { DownloadButton } from "./download-button";
import { cn } from "@/lib/utils";

/**
 * FileCard — the artifact card used for EVERY file in chat, including
 * presentations. One layout, one interaction model; only the icon, colour
 * and type label change per format.
 */

type CardKind = ArtifactKind | "image" | "audio" | "video" | "archive" | "generic";

type KindMeta = {
  kind: CardKind;
  icon: typeof FileIcon;
  iconClass: string;
  label: string;
};

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "flac", "m4a"]);
const VIDEO = new Set(["mp4", "mov", "webm", "mkv", "avi"]);
const ARCHIVE = new Set(["zip", "tar", "gz", "rar", "7z"]);

function metaFor(filename: string): KindMeta {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (IMAGE.has(ext)) return { kind: "image", icon: ImageIcon, iconClass: "text-sky-600 dark:text-sky-400", label: "Image" };
  if (AUDIO.has(ext)) return { kind: "audio", icon: MusicIcon, iconClass: "text-violet-600 dark:text-violet-400", label: "Audio" };
  if (VIDEO.has(ext)) return { kind: "video", icon: VideoIcon, iconClass: "text-fuchsia-600 dark:text-fuchsia-400", label: "Video" };
  if (ARCHIVE.has(ext)) return { kind: "archive", icon: FileArchiveIcon, iconClass: "text-amber-600 dark:text-amber-400", label: "Archive" };

  const kind = detectArtifactKind(filename);
  switch (kind) {
    case "slides":
      return { kind, icon: PresentationIcon, iconClass: "text-orange-600 dark:text-orange-400", label: /^pptx?$/i.test(ext) ? `Presentation · ${ext.toUpperCase()}` : "Presentation" };
    case "pdf":
      return { kind, icon: FileTextIcon, iconClass: "text-red-600 dark:text-red-400", label: "PDF" };
    case "sheet":
      return { kind, icon: TableIcon, iconClass: "text-emerald-600 dark:text-emerald-400", label: ext === "csv" || ext === "tsv" ? "CSV spreadsheet" : "Spreadsheet" };
    case "doc":
      return { kind, icon: FileTextIcon, iconClass: "text-blue-600 dark:text-blue-400", label: /^(md|markdown)$/i.test(ext) ? "Markdown" : ext === "docx" ? "Word document" : "Document" };
    case "html":
      return { kind, icon: FileIcon, iconClass: "text-amber-600 dark:text-amber-400", label: "HTML page" };
    case "code":
      return { kind, icon: FileIcon, iconClass: "text-violet-600 dark:text-violet-400", label: `${ext ? ext.toUpperCase() : "Source"} · Source` };
    default:
      return { kind: "generic", icon: FileIcon, iconClass: "text-muted-foreground", label: ext ? ext.toUpperCase() : "File" };
  }
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
  const meta = metaFor(filename);
  const Icon = meta.icon;
  const canOpen = !!filePath && meta.kind !== "image" && meta.kind !== "audio" && meta.kind !== "video" && meta.kind !== "archive";

  const handleOpen = () => {
    if (!filePath) return;
    openDocumentWorkspace({ filePath, filename, downloadUrl });
  };

  return (
    <span
      className="flex w-full items-center gap-2.5 rounded-2xl border border-border/70 bg-background py-2 pr-1.5 pl-2.5 text-sm shadow-xs transition-colors hover:border-border"
      data-artifact-card={meta.kind}
    >
      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted/60", meta.iconClass)}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground" title={filename}>
          {filename}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">{meta.label}</span>
      </span>
      <span className="flex shrink-0 items-center">
        {canOpen && (
          <button
            onClick={handleOpen}
            title="Open"
            aria-label={`Open ${filename}`}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <SquareArrowOutUpRightIcon className="size-4" />
          </button>
        )}
        <DownloadButton filename={filename} downloadUrl={downloadUrl} />
      </span>
    </span>
  );
}
