"use client";

import { FileTextIcon, FileSpreadsheetIcon, FileImageIcon, FileArchiveIcon, FileIcon } from "lucide-react";

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

  const handleCopyPath = async () => {
    if (filePath) {
      try {
        await navigator.clipboard.writeText(filePath);
      } catch {}
    }
  };

  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm shadow-xs">
      <Icon className={`size-4 shrink-0 ${color}`} />
      <span className="truncate font-medium text-foreground max-w-[180px]">{filename}</span>
      {filePath && (
        <button
          onClick={handleCopyPath}
          title="Copy file path"
          className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
        >
          <svg className="size-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
          </svg>
          {filePath.split("/").slice(0, -1).join("/") || "."}
        </button>
      )}
      <a
        href={downloadUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
      >
        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Open
      </a>
    </div>
  );
}
