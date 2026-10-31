"use client";

import { useAuiState } from "@assistant-ui/react";
import { DownloadButton } from "@/components/assistant-ui/tools/download-button";
import { DocComposer } from "@/components/workspace/DocComposer";
import { useWorkspaceStore } from "@/lib/workspace/store";
import { detectArtifactKind } from "@/lib/artifact/kinds";
import { ArtifactShell, ArtifactShellStyles } from "./ArtifactShell";
import { ARTIFACT_DEFINITIONS, ArtifactViewer } from "./registry";

/**
 * The single popup used by every standard file type. It owns nothing
 * type-specific: the registry supplies the viewer, the shell supplies the
 * window, and the composer stays shared.
 */
export function ArtifactPopup() {
  const open = useWorkspaceStore((s) => s.open);
  const artifact = useWorkspaceStore((s) => s.artifact);
  const closeWorkspace = useWorkspaceStore((s) => s.closeWorkspace);
  const isRunning = useAuiState((s) => s.thread.isRunning);

  if (!open || !artifact) return null;
  // Browser/computer sessions and HTML pages have their own side panels.
  if (artifact.kind === "browser" || artifact.kind === "computer" || artifact.kind === "html") return null;

  const filePath = artifact.filePath || "";
  const filename = artifact.title || filePath.split("/").pop() || "file";
  const kind =
    artifact.kind === "pdf" ||
    artifact.kind === "doc" ||
    artifact.kind === "sheet" ||
    artifact.kind === "slides" ||
    artifact.kind === "code" ||
    artifact.kind === "text"
      ? artifact.kind
      : detectArtifactKind(filename);
  const def = ARTIFACT_DEFINITIONS[kind] ?? ARTIFACT_DEFINITIONS.text;
  const Icon = def.icon;
  const downloadUrl = artifact.downloadUrl || `/api/files/${filePath}`;

  return (
    <>
      <ArtifactShell
        open
        title={filename}
        ariaLabel={`${def.label}: ${filename}`}
        icon={<Icon className={`size-4 ${def.iconClass}`} aria-hidden="true" />}
        badge={
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            {def.label}
          </span>
        }
        onClose={closeWorkspace}
        download={<DownloadButton filename={filename} downloadUrl={downloadUrl} />}
        size={def.size}
        running={isRunning}
        className="has-composer"
        footer={
          artifact.filePath ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30">
              <div className="pointer-events-auto">
                <DocComposer artifact={artifact} />
              </div>
            </div>
          ) : null
        }
      >
        {artifact.filePath ? (
          <ArtifactViewer
            key={artifact.id}
            kind={kind}
            filePath={artifact.filePath}
            filename={filename}
            downloadUrl={downloadUrl}
            slide={artifact.slide}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            This artifact has no previewable file.
          </div>
        )}
      </ArtifactShell>
      <ArtifactShellStyles />
      <style>{`.has-composer [data-artifact-scroll] { padding-bottom: 5.5rem; }`}</style>
    </>
  );
}
