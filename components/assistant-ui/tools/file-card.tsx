"use client";

import { FileTextIcon, FileSpreadsheetIcon, FileImageIcon, FileArchiveIcon, FileIcon, SquareArrowOutUpRightIcon } from "lucide-react";
import { openDocumentWorkspace } from "@/lib/workspace/store";
import { DownloadButton } from "./download-button";

const FILE_ICONS: Record<string, { icon: typeof FileIcon; color: string }> = {
  pptx: { icon: FileTextIcon, color: "text-orange-500" },
  ppt: { icon: FileTextIcon, color: "text-orange-500" },
  docx: { icon: FileTextIcon, color: "text-blue-600" },
  doc: { icon: FileTextIcon, color: "text-blue-600" },
  xlsx: { icon: FileSpreadsheetIcon, color: "text-green-600" },
  xls: { icon: FileSpreadsheetIcon, color: "text-green-600" },
  csv: { icon: FileSpreadsheetIcon, color: "text-green-600" },
  pdf: { icon: FileTextIcon, color: "text-red-500" },
  png: { icon: FileImageIcon, color: "text-sky-500" },
  jpg: { icon: FileImageIcon, color: "text-sky-500" },
  jpeg: { icon: FileImageIcon, color: "text-sky-500" },
  gif: { icon: FileImageIcon, color: "text-purple-500" },
  svg: { icon: FileImageIcon, color: "text-yellow-500" },
  zip: { icon: FileArchiveIcon, color: "text-amber-600" },
};

const OPENABLE = new Set(["doc", "docx", "odt", "rtf", "xls", "xlsx", "ods", "csv", "txt", "md", "markdown", "json", "js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "h", "css", "html", "yml", "yaml", "toml", "sh", "sql", "xml", "log"]);
// Slides (ppt/pptx/odp) and PDFs are download-only — no in-app viewer.

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
  const entry = FILE_ICONS[ext];
  const Icon = entry?.icon || FileIcon;
  const color = entry?.color || "text-muted-foreground";
  const canOpen = OPENABLE.has(ext) && !!filePath;

  const handleOpen = () => {
    if (!filePath) return;
    openDocumentWorkspace({ filePath, filename, downloadUrl });
  };

  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-background py-1 pr-1 pl-3 text-sm shadow-xs">
      <Icon className={`size-4 shrink-0 ${color}`} aria-hidden="true" />
      <span className="max-w-[180px] truncate font-medium text-foreground">{filename}</span>
      <div className="flex shrink-0 items-center">
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
      </div>
    </div>
  );
}
