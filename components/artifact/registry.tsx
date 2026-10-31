"use client";

import dynamic from "next/dynamic";
import {
  CodeIcon,
  FileTextIcon,
  FileTypeIcon,
  PresentationIcon,
  TableIcon,
  type LucideIcon,
} from "lucide-react";
import type { ArtifactKind } from "@/lib/artifact/kinds";
import type { ArtifactShellSize } from "./ArtifactShell";
import { ArtifactLoading } from "./states";

/**
 * Artifact-type registry: the one place that maps a kind to its icon,
 * label, popup size and inner viewer. The shell never branches on type,
 * and viewers are lazy-loaded so opening a document does not pay for the
 * PDF engine or the slide renderer.
 */

const DocumentViewer = dynamic(() => import("./viewers/DocumentViewer").then((m) => m.DocumentViewer), {
  ssr: false,
  loading: () => <ArtifactLoading label="Opening document…" />,
});
const SlidesViewer = dynamic(() => import("./viewers/SlidesViewer").then((m) => m.SlidesViewer), {
  ssr: false,
  loading: () => <ArtifactLoading label="Rendering slides…" />,
});
const SheetViewer = dynamic(() => import("./viewers/SheetViewer").then((m) => m.SheetViewer), {
  ssr: false,
  loading: () => <ArtifactLoading label="Opening spreadsheet…" />,
});
const PdfViewer = dynamic(() => import("./viewers/PdfViewer").then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => <ArtifactLoading label="Rendering PDF…" />,
});
const CodeViewer = dynamic(() => import("./viewers/CodeViewer").then((m) => m.CodeViewer), {
  ssr: false,
  loading: () => <ArtifactLoading label="Opening source file…" />,
});
const TextViewer = dynamic(() => import("./viewers/TextViewer").then((m) => m.TextViewer), {
  ssr: false,
  loading: () => <ArtifactLoading label="Opening file…" />,
});

export type ArtifactDefinition = {
  kind: ArtifactKind;
  label: string;
  icon: LucideIcon;
  iconClass: string;
  size: ArtifactShellSize;
  /** true when the type opens in the shared centered popup. */
  popup: boolean;
};

export const ARTIFACT_DEFINITIONS: Record<ArtifactKind, ArtifactDefinition> = {
  doc: {
    kind: "doc",
    label: "Document",
    icon: FileTextIcon,
    iconClass: "text-blue-600 dark:text-blue-400",
    size: "document",
    popup: true,
  },
  slides: {
    kind: "slides",
    label: "Presentation",
    icon: PresentationIcon,
    iconClass: "text-orange-600 dark:text-orange-400",
    size: "media",
    popup: true,
  },
  sheet: {
    kind: "sheet",
    label: "Spreadsheet",
    icon: TableIcon,
    iconClass: "text-emerald-600 dark:text-emerald-400",
    size: "wide",
    popup: true,
  },
  pdf: {
    kind: "pdf",
    label: "PDF",
    icon: FileTypeIcon,
    iconClass: "text-red-600 dark:text-red-400",
    size: "wide",
    popup: true,
  },
  code: {
    kind: "code",
    label: "Source",
    icon: CodeIcon,
    iconClass: "text-violet-600 dark:text-violet-400",
    size: "wide",
    popup: true,
  },
  text: {
    kind: "text",
    label: "Text",
    icon: FileTextIcon,
    iconClass: "text-muted-foreground",
    size: "document",
    popup: true,
  },
  // HTML artifacts are intentionally NOT popups: they open in the minimal
  // side panel so the page keeps its own layout and scrolling.
  html: {
    kind: "html",
    label: "HTML",
    icon: CodeIcon,
    iconClass: "text-amber-600 dark:text-amber-400",
    size: "document",
    popup: false,
  },
};

export function ArtifactViewer({
  kind,
  filePath,
  filename,
  downloadUrl,
  slide,
}: {
  kind: ArtifactKind;
  filePath: string;
  filename: string;
  downloadUrl: string;
  slide?: number;
}) {
  switch (kind) {
    case "doc":
      return <DocumentViewer filePath={filePath} />;
    case "slides":
      return <SlidesViewer filePath={filePath} downloadUrl={downloadUrl} initialSlide={slide} />;
    case "sheet":
      return <SheetViewer filePath={filePath} />;
    case "pdf":
      return <PdfViewer filePath={filePath} downloadUrl={downloadUrl} />;
    case "code":
      return <CodeViewer filePath={filePath} filename={filename} />;
    case "html":
    default:
      return <TextViewer filePath={filePath} filename={filename} />;
  }
}
