"use client";

import { PdfWorkspace } from "./PdfWorkspace";
import { DocWorkspace } from "./DocWorkspace";
import { SpreadsheetWorkspace } from "./SpreadsheetWorkspace";
import { PresentationWorkspace } from "./PresentationWorkspace";
import { CodeWorkspace } from "./CodeWorkspace";
import { TextWorkspace } from "./TextWorkspace";
import type { WorkspaceArtifact } from "@/lib/workspace/types";

export function DocumentWorkspace({ artifact }: { artifact: WorkspaceArtifact }) {
  const filePath = artifact.filePath || "";
  const downloadUrl = artifact.downloadUrl || `/api/files/${encodeURIComponent(filePath)}`;
  switch (artifact.kind) {
    case "pdf":
      return <PdfWorkspace filePath={filePath} downloadUrl={downloadUrl} />;
    case "doc":
      return <DocWorkspace filePath={filePath} downloadUrl={downloadUrl} />;
    case "sheet":
      return <SpreadsheetWorkspace filePath={filePath} downloadUrl={downloadUrl} />;
    case "slides":
      return <PresentationWorkspace filePath={filePath} downloadUrl={downloadUrl} />;
    case "code":
      return <CodeWorkspace filePath={filePath} downloadUrl={downloadUrl} />;
    default:
      return <TextWorkspace filePath={filePath} downloadUrl={downloadUrl} />;
  }
}
