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

  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm shadow-xs">
      <Icon className={`size-4 shrink-0 ${color}`} />
      <span className="truncate font-medium text-foreground max-w-[180px]">{filename}</span>
      <a
        href={downloadUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
      >
        <svg className="size-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
        Download
      </a>
    </div>
  );
}
