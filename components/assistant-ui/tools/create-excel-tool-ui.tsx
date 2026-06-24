"use client";

import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { FileSpreadsheetIcon } from "lucide-react";

export const CreateExcelToolUI: ToolCallMessagePartComponent = ({
  args,
  result,
}) => {
  const filename = (args as any)?.filename || "";
  const sheetName = (args as any)?.sheetName || "Sheet1";
  const rowCount = (args as any)?.data?.length || 0;
  let data: { path?: string; rows?: number } = {};
  try {
    if (typeof result === "string") data = JSON.parse(result);
    else if (result) data = result as typeof data;
  } catch {}

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground">
        <FileSpreadsheetIcon className="size-4" />
        <span>Create Spreadsheet</span>
      </div>
      <div className="flex flex-col gap-1 font-mono text-xs text-muted-foreground">
        <span>File: {data.path || filename}</span>
        <span>Sheet: {sheetName}</span>
        <span>Rows: {data.rows ?? rowCount}</span>
      </div>
      {(data.rows ?? rowCount) > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <span className="size-1.5 rounded-full bg-green-500" />
          Spreadsheet created successfully
        </div>
      )}
    </div>
  );
};
