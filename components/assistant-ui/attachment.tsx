"use client";

import { type PropsWithChildren, useEffect, useState, type FC } from "react";
import { XIcon, PlusIcon, FileText, Loader2Icon } from "lucide-react";
import {
  AttachmentPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useAuiState,
  useAui,
} from "@assistant-ui/react";
import { useShallow } from "zustand/shallow";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogTrigger,
  DialogHeader,
} from "@/components/ui/dialog";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { cn } from "@/lib/utils";
import {
  isTextAttachment,
  mediaTypeFromFilename,
  previewAttachment,
  type AttachmentPreview,
} from "@/lib/chat/attachments";


const useFileSrc = (file: File | undefined) => {
  const [src, setSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!file) {
      setSrc(undefined);
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setSrc(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return src;
};

const useAttachmentSrc = () => {
  const { file, src } = useAuiState(
    useShallow((s): { file?: File; src?: string } => {
      if (s.attachment.type !== "image") return {};
      if (s.attachment.file) return { file: s.attachment.file };
      const src = s.attachment.content?.filter((c) => c.type === "image")[0]
        ?.image;
      if (!src) return {};
      return { src };
    }),
  );

  return useFileSrc(file) ?? src;
};

type AttachmentPreviewProps = {
  src: string;
};

const AttachmentPreview: FC<AttachmentPreviewProps> = ({ src }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  return (
    <img
      src={src}
      alt="Attachment preview"
      className={cn(
        "block h-auto max-h-[80vh] w-auto max-w-full object-contain",
        isLoaded
          ? "aui-attachment-preview-image-loaded"
          : "aui-attachment-preview-image-loading invisible",
      )}
      onLoad={() => setIsLoaded(true)}
    />
  );
};

const AttachmentPreviewDialog: FC<PropsWithChildren> = ({ children }) => {
  const src = useAttachmentSrc();

  if (!src) return children;

  return (
    <Dialog>
      <DialogTrigger
        className="aui-attachment-preview-trigger hover:bg-accent/50 cursor-pointer transition-colors"
        asChild
      >
        {children}
      </DialogTrigger>
      <DialogContent className="aui-attachment-preview-dialog-content [&>button]:bg-foreground/60 [&_svg]:text-background [&>button]:hover:[&_svg]:text-destructive p-2 sm:max-w-3xl [&>button]:rounded-full [&>button]:p-1 [&>button]:opacity-100 [&>button]:ring-0!">
        <DialogTitle className="aui-sr-only sr-only">
          Image Attachment Preview
        </DialogTitle>
        <div className="aui-attachment-preview bg-background relative mx-auto flex max-h-[80dvh] w-full items-center justify-center overflow-hidden">
          <AttachmentPreview src={src} />
        </div>
      </DialogContent>
    </Dialog>
  );
};

const AttachmentThumb: FC = () => {
  const src = useAttachmentSrc();

  return (
    <Avatar className="aui-attachment-tile-avatar h-full w-full rounded-none">
      <AvatarImage
        src={src}
        alt="Attachment preview"
        className="aui-attachment-tile-image object-cover"
      />
      <AvatarFallback>
        <FileText className="aui-attachment-tile-fallback-icon text-muted-foreground size-8" />
      </AvatarFallback>
    </Avatar>
  );
};

const MAX_PREVIEW_BYTES = 2_000_000;

type DocumentPreviewState =
  | { status: "loading" }
  | { status: "text"; text: string }
  | { status: "binary"; dataUrl?: string; mediaType: string; sizeBytes?: number }
  | { status: "too-large"; sizeBytes?: number }
  | { status: "unavailable" };

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function formatPreviewSize(bytes?: number): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stateFromAttachmentPreview(preview: AttachmentPreview): DocumentPreviewState {
  switch (preview.kind) {
    case "text":
      return { status: "text", text: preview.text };
    case "binary":
      return {
        status: "binary",
        dataUrl: preview.dataUrl,
        mediaType: preview.mediaType,
        sizeBytes: preview.sizeBytes,
      };
    case "too-large":
      return { status: "too-large", sizeBytes: preview.sizeBytes };
    default:
      return { status: "unavailable" };
  }
}

const DocumentPreviewDialog: FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filename: string;
}> = ({ open, onOpenChange, filename }) => {
  const file = useAuiState((s) => (s.attachment as unknown as { file?: File })?.file);
  const content = useAuiState(
    (s) => (s.attachment as unknown as { content?: unknown })?.content,
  );
  const [preview, setPreview] = useState<DocumentPreviewState>({ status: "loading" });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview({ status: "loading" });
    (async () => {
      try {
        if (file) {
          if (file.size > MAX_PREVIEW_BYTES) {
            if (!cancelled) setPreview({ status: "too-large", sizeBytes: file.size });
            return;
          }
          const bytes = new Uint8Array(await file.arrayBuffer());
          const mediaType = file.type || mediaTypeFromFilename(filename);
          if (isTextAttachment({ filename, mediaType, bytes })) {
            const text = await file.text();
            if (!cancelled) setPreview({ status: "text", text });
            return;
          }
          const dataUrl = await readFileAsDataUrl(file);
          if (!cancelled) {
            setPreview({ status: "binary", dataUrl, mediaType, sizeBytes: file.size });
          }
          return;
        }
        // Sent/restored messages have no raw File; their bytes live in a
        // `data:` URL file part. Decode that URL so retry keeps the preview.
        const fromContent = previewAttachment({
          content,
          filename,
          maxBytes: MAX_PREVIEW_BYTES,
        });
        if (!cancelled) setPreview(stateFromAttachmentPreview(fromContent));
      } catch {
        if (!cancelled) setPreview({ status: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, file, content, filename]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-3xl border border-border bg-background p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 text-left">
          <DialogTitle className="truncate text-base">{filename}</DialogTitle>
          <DialogDescription className="sr-only">
            Document preview for {filename}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-6 pb-6">
          <div className="min-h-0 flex-1 overflow-y-auto text-sm leading-relaxed text-foreground scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {preview.status === "loading" ? (
              <div className="flex items-center justify-center py-12">
                <Loader2Icon className="size-5 animate-spin text-muted-foreground/40" />
              </div>
            ) : preview.status === "too-large" ? (
              <p className="text-xs text-muted-foreground">
                This file is too large to preview{formatPreviewSize(preview.sizeBytes) ? ` (${formatPreviewSize(preview.sizeBytes)})` : ""}. Open or download it to review the contents.
              </p>
            ) : preview.status === "text" ? (
              <pre className="font-mono text-[13px] leading-relaxed whitespace-pre-wrap wrap-break-word">
                {preview.text}
              </pre>
            ) : preview.status === "binary" && preview.mediaType === "application/pdf" && preview.dataUrl ? (
              <div className="flex flex-col gap-3">
                <iframe
                  src={preview.dataUrl}
                  title={`PDF preview of ${filename}`}
                  className="h-[65vh] w-full rounded-xl border border-border bg-white"
                />
                <a
                  href={preview.dataUrl}
                  download={filename}
                  className="text-xs font-medium text-blue-600 underline-offset-2 hover:underline"
                >
                  Download original
                </a>
              </div>
            ) : preview.status === "binary" && preview.mediaType.startsWith("image/") && preview.dataUrl ? (
              <div className="flex flex-col items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview.dataUrl} alt={filename} className="max-h-[65vh] max-w-full object-contain" />
                <a
                  href={preview.dataUrl}
                  download={filename}
                  className="text-xs font-medium text-blue-600 underline-offset-2 hover:underline"
                >
                  Download original
                </a>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <FileText className="size-8 text-blue-500/60" />
                <p className="text-xs text-muted-foreground">
                  This attachment doesn’t have an inline text preview. You can still open or download the original file.
                </p>
                {preview.status === "binary" && preview.mediaType ? (
                  <p className="text-[11px] text-muted-foreground/70">
                    {preview.mediaType}{formatPreviewSize(preview.sizeBytes) ? ` • ${formatPreviewSize(preview.sizeBytes)}` : ""}
                  </p>
                ) : null}
                {preview.status === "binary" && preview.dataUrl ? (
                  <a
                    href={preview.dataUrl}
                    download={filename}
                    className="mt-2 rounded-full bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    Open / download
                  </a>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const DocumentAttachmentChip: FC = () => {
  const name = useAuiState((s) => (s.attachment as unknown as { name?: string })?.name || "Document");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={name}
        className="aui-attachment-doc-chip flex w-full max-w-[320px] cursor-pointer items-center gap-3 rounded-2xl border border-border/60 bg-muted/40 px-4 py-3 text-left transition-colors hover:bg-muted/60"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/10">
          <FileText className="size-5 text-blue-500" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {name}
        </span>
      </button>
      <DocumentPreviewDialog
        open={open}
        onOpenChange={setOpen}
        filename={name}
      />
    </>
  );
};

const AttachmentUI: FC = () => {
  const aui = useAui();
  const isComposer = aui.attachment.source !== "message";

  const isImage = useAuiState((s) => s.attachment.type === "image");
  const typeLabel = useAuiState((s) => {
    const type = s.attachment.type;
    switch (type) {
      case "image":
        return "Image";
      case "document":
        return "Document";
      case "file":
        return "File";
      default:
        return type;
    }
  });

  if (!isImage) {
    return (
      <AttachmentPrimitive.Root className="aui-attachment-root group relative">
        <DocumentAttachmentChip />
        {isComposer && <AttachmentRemove />}
      </AttachmentPrimitive.Root>
    );
  }

  return (
    <Tooltip>
      <AttachmentPrimitive.Root
        className={cn(
          "aui-attachment-root group relative",
          isImage &&
            !isComposer &&
            "aui-attachment-root-message only:*:first:size-24",
        )}
      >
        <AttachmentPreviewDialog>
          <TooltipTrigger asChild>
            <div
              className="aui-attachment-tile bg-muted size-14 cursor-pointer overflow-hidden rounded-[calc(var(--composer-radius)-var(--composer-padding))] border transition-opacity hover:opacity-75"
              role="button"
              tabIndex={0}
              aria-label={`${typeLabel} attachment`}
            >
              <AttachmentThumb />
            </div>
          </TooltipTrigger>
        </AttachmentPreviewDialog>
        {isComposer && <AttachmentRemove />}
      </AttachmentPrimitive.Root>
      <TooltipContent side="top">
        <AttachmentPrimitive.Name />
      </TooltipContent>
    </Tooltip>
  );
};

const AttachmentRemove: FC = () => {
  return (
    <AttachmentPrimitive.Remove asChild>
      <TooltipIconButton
        tooltip="Remove file"
        className="aui-attachment-tile-remove text-muted-foreground absolute end-1.5 top-1.5 size-3.5 rounded-full bg-white opacity-0 shadow-sm transition-[opacity,background-color,color] duration-150 group-hover:opacity-100 hover:bg-white! hover:[&_svg]:text-destructive [&_svg]:size-3 [&_svg]:text-black"
        side="top"
      >
        <XIcon className="aui-attachment-remove-icon dark:stroke-[2.5px]" />
      </TooltipIconButton>
    </AttachmentPrimitive.Remove>
  );
};

export const UserMessageAttachments: FC = () => {
  return (
    <div className="aui-user-message-attachments-end col-span-full col-start-1 row-start-1 flex w-full flex-row justify-end gap-2">
      <MessagePrimitive.Attachments>
        {() => <AttachmentUI />}
      </MessagePrimitive.Attachments>
    </div>
  );
};

export const ComposerAttachments: FC = () => {
  return (
    <div className="aui-composer-attachments flex w-full flex-row items-center gap-2 overflow-x-auto empty:hidden">
      <ComposerPrimitive.Attachments>
        {() => <AttachmentUI />}
      </ComposerPrimitive.Attachments>
    </div>
  );
};

const IMAGE_ACCEPT = "image/*,.pdf,.docx,.xlsx,.csv,.zip,.pptx,.txt,.md";
const DOCS_ACCEPT = ".pdf,.docx,.xlsx,.csv,.zip,.pptx,.txt,.md";

function modelSupportsImages(qualifiedModelId: string): boolean {
  try {
    const raw = localStorage.getItem("qube-providers");
    if (!raw) return false;
    const providers = JSON.parse(raw);
    for (const p of providers) {
      if (!p.models || !Array.isArray(p.models)) continue;
      for (const m of p.models) {
        if (m.id === qualifiedModelId) return m.imageInput === true;
      }
    }
  } catch {}
  return false;
}

export const ComposerAddAttachment: FC = () => {
  const aui = useAui();
  const [model, setModel] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem("qube-default-model") || "";
    setModel(saved);
  }, []);

  const supportsImages = modelSupportsImages(model);
  const accept = supportsImages ? IMAGE_ACCEPT : DOCS_ACCEPT;

  const handleClick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = accept;
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files) { document.body.removeChild(input); return; }
      for (const file of files) {
        if (!supportsImages && file.type.startsWith("image/")) continue;
        aui.composer().addAttachment(file).catch(console.error);
      }
      document.body.removeChild(input);
    };
    input.oncancel = () => {
      if (!input.files || input.files.length === 0) document.body.removeChild(input);
    };
    input.click();
  };

  return (
    <TooltipIconButton
      tooltip="Add Attachment"
      side="bottom"
      variant="ghost"
      size="icon"
      className="aui-composer-add-attachment hover:bg-muted-foreground/15 dark:border-muted-foreground/15 dark:hover:bg-muted-foreground/30 !size-7 rounded-full p-1 text-xs font-semibold"
      aria-label={supportsImages ? "Add Attachment (images & docs)" : "Add Attachment (docs only)"}
      onClick={handleClick}
    >
      <PlusIcon className="aui-attachment-add-icon size-4.5 stroke-[1.5px]" />
    </TooltipIconButton>
  );
};
