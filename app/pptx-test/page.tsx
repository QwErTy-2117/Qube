"use client";

import { FileCard } from "@/components/assistant-ui/tools/file-card";

const filePath = "presentations/Northwind Q4 Project Update.pptx";
const filename = "Northwind Q4 Project Update.pptx";
const downloadUrl = `/api/files/${filePath.split("/").map(encodeURIComponent).join("/")}`;

export default function PptxTestPage() {
  return (
    <div className="fixed inset-0 z-40 overflow-auto bg-background p-10">
      <div className="mx-auto flex w-full max-w-[440px] flex-col gap-4">
        <p className="text-xs font-medium text-muted-foreground">PPTX preview test harness</p>
        <FileCard filename={filename} filePath={filePath} downloadUrl={downloadUrl} />
      </div>
    </div>
  );
}
