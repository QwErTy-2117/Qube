"use client";

import { useState } from "react";
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
import { DownloadButton } from "./download-button";
import { cn } from "@/lib/utils";

const OPENABLE = new Set(["doc", "docx", "odt", "rtf", "xls", "xlsx", "ods", "csv", "txt", "md", "markdown", "json", "js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "css", "html", "yml", "yaml", "toml", "sh", "sql", "xml", "log", "pdf", "ppt", "pptx", "odp"]);

const CODE_EXTS = new Set([
  "js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h",
  "css", "html", "json", "yml", "yaml", "toml", "sh", "sql", "xml",
  "log", "jsm", "mjs", "cjs", "vue", "svelte", "rb", "php",
]);

type CardKind = "slides" | "pdf" | "doc" | "sheet" | "image" | "audio" | "video" | "archive" | "generic";

type KindMeta = {
  kind: CardKind;
  label: string;
  icon: typeof FileIcon;
  iconClass: string;
  tileClass: string;
};

function metaForExt(ext: string): KindMeta {
  if (ext === "ppt" || ext === "pptx" || ext === "odp" || ext === "key")
    return { kind: "slides", label: "Presentation", icon: PresentationIcon, iconClass: "text-orange-600 dark:text-orange-400", tileClass: "bg-orange-500/12 text-orange-600 dark:text-orange-400" };
  if (ext === "pdf")
    return { kind: "pdf", label: "PDF", icon: FileTextIcon, iconClass: "text-red-600 dark:text-red-400", tileClass: "bg-red-500/12 text-red-600 dark:text-red-400" };
  if (["doc", "docx", "odt", "rtf", "md", "markdown", "txt"].includes(ext))
    return { kind: "doc", label: ext === "md" || ext === "markdown" ? "Markdown" : ext === "txt" ? "Text" : "Document", icon: FileTextIcon, iconClass: "text-blue-600 dark:text-blue-400", tileClass: "bg-blue-500/12 text-blue-600 dark:text-blue-400" };
  if (["xls", "xlsx", "ods", "csv", "tsv"].includes(ext))
    return { kind: "sheet", label: "Spreadsheet", icon: TableIcon, iconClass: "text-emerald-600 dark:text-emerald-400", tileClass: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" };
  if (["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif"].includes(ext))
    return { kind: "image", label: "Image", icon: ImageIcon, iconClass: "text-sky-600 dark:text-sky-400", tileClass: "bg-sky-500/12 text-sky-600 dark:text-sky-400" };
  if (["mp3", "wav", "ogg", "flac", "m4a"].includes(ext))
    return { kind: "audio", label: "Audio", icon: MusicIcon, iconClass: "text-violet-600 dark:text-violet-400", tileClass: "bg-violet-500/12 text-violet-600 dark:text-violet-400" };
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext))
    return { kind: "video", label: "Video", icon: VideoIcon, iconClass: "text-fuchsia-600 dark:text-fuchsia-400", tileClass: "bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400" };
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext))
    return { kind: "archive", label: "Archive", icon: FileArchiveIcon, iconClass: "text-amber-600 dark:text-amber-400", tileClass: "bg-amber-500/12 text-amber-600 dark:text-amber-400" };
  return { kind: "generic", label: ext ? `${ext.toUpperCase()} file` : "File", icon: FileIcon, iconClass: "text-muted-foreground", tileClass: "bg-muted text-muted-foreground" };
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

  // Code files keep the compact pill (excluded from rich cards).
  if (CODE_EXTS.has(ext)) {
    return (
      <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-background py-1 pr-1 pl-3 text-sm shadow-xs">
        <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="max-w-[180px] truncate font-medium text-foreground">{filename}</span>
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

  const meta = metaForExt(ext);
  const Icon = meta.icon;
  return (
    <span className="flex w-full max-w-[380px] items-center gap-3 rounded-2xl border border-border/70 bg-background p-2.5 pr-2 text-left shadow-xs">
      <DocumentTile ext={ext} downloadUrl={downloadUrl} meta={meta} filename={filename} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground" title={filename}>
          {filename}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {meta.label}
          {ext ? ` • ${ext.toUpperCase()}` : ""}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5">
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

function DocumentTile({ ext, downloadUrl, meta, filename }: { ext: string; downloadUrl: string; meta: KindMeta; filename: string }) {
  const [imgOk, setImgOk] = useState(true);
  const isImage = meta.kind === "image";
  if (isImage && imgOk) {
    return (
      <span className={cn("flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl", meta.tileClass)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={downloadUrl}
          alt=""
          aria-hidden="true"
          className="size-full object-cover"
          loading="lazy"
          onError={() => setImgOk(false)}
        />
        <span className="sr-only">{filename}</span>
      </span>
    );
  }
  const Icon = meta.icon;
  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl", meta.tileClass)}>
      <Icon className={cn("size-5", meta.iconClass)} aria-hidden="true" />
    </span>
  );
}
