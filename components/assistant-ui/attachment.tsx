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
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { cn } from "@/lib/utils";


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

const TEXT_PREVIEW_EXTS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "log",
  "js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp",
  "h", "css", "html", "yml", "yaml", "toml", "sh", "sql", "xml",
]);

function getAttachmentText(
  file: File | undefined,
  content: Array<{ type?: string; text?: string; data?: string }> | undefined,
): string | null {
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const part of content) {
      if (part && part.type === "text" && typeof part.text === "string" && part.text.trim()) {
        texts.push(part.text);
      }
    }
    if (texts.length > 0) return texts.join("\n");
  }
  return null;
}

const DocumentPreviewDialog: FC<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filename: string;
  isComposer: boolean;
}> = ({ open, onOpenChange, filename, isComposer }) => {
  const aui = useAui();
  const file = useAuiState((s) => (s.attachment as unknown as { file?: File })?.file);
  const content = useAuiState(
    (s) => (s.attachment as unknown as { content?: Array<{ type?: string; text?: string }> })?.content,
  );
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const [binary, setBinary] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBody(null);
    setTooLarge(false);
    setBinary(false);
    setLoading(true);
    (async () => {
      try {
        if (file) {
          if (file.size > 2_000_000) {
            if (!cancelled) setTooLarge(true);
            return;
          }
          const ext = (file.name.split(".").pop() || "").toLowerCase();
          const textLike =
            file.type.startsWith("text/") ||
            file.type === "application/json" ||
            file.type === "" ||
            TEXT_PREVIEW_EXTS.has(ext);
          if (!textLike) {
            if (!cancelled) setBinary(true);
            return;
          }
          const text = await file.text();
          if (!cancelled) {
            setBody(text);
            setDraft(text);
          }
          return;
        }
        const fromContent = getAttachmentText(
          undefined,
          content as Array<{ type?: string; text?: string }> | undefined,
        );
        if (!cancelled) {
          if (fromContent) {
            setBody(fromContent);
            setDraft(fromContent);
          } else {
            setBinary(true);
          }
        }
      } catch {
        if (!cancelled) setBinary(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, file, content]);

  const editable = isComposer && !!file && body !== null && !binary && !tooLarge;
  const dirty = editable && draft !== body;

  const handleSave = async () => {
    if (!file || !editable) return;
    setSaving(true);
    try {
      const next = new File([draft], file.name, {
        type: file.type || "text/plain",
        lastModified: Date.now(),
      });
      try {
        await ((aui as unknown as { attachment?: { remove?: () => Promise<void> } }).attachment?.remove?.());
      } catch {}
      await aui.composer().addAttachment(next).catch(console.error);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-3xl border border-border bg-background p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 text-left">
          <DialogTitle className="truncate text-base">{filename}</DialogTitle>
          <DialogDescription className="sr-only">
            Document preview for {filename}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-5 pb-5">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-border/60 bg-muted/20">
            <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-16 text-sm leading-relaxed text-foreground scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2Icon className="size-5 animate-spin text-muted-foreground/40" />
                </div>
              ) : tooLarge ? (
                <p className="text-xs text-muted-foreground">
                  This file is too large to preview. Remove it or open it externally to review the contents.
                </p>
              ) : binary ? (
                <div className="flex flex-col items-center gap-2 py-10 text-center">
                  <FileText className="size-8 text-blue-500/60" />
                  <p className="text-xs text-muted-foreground">
                    No text preview available for this file type.
                  </p>
                </div>
              ) : editable ? (
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck
                  className="min-h-[320px] w-full resize-y rounded-xl bg-transparent p-1 font-mono text-[13px] leading-relaxed whitespace-pre-wrap outline-none"
                />
              ) : (
                <pre className="font-mono text-[13px] leading-relaxed whitespace-pre-wrap wrap-break-word">
                  {body ?? ""}
                </pre>
              )}
            </div>
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="h-8 rounded-full bg-background/90 px-4 shadow-md backdrop-blur-md"
              >
                Close
              </Button>
              {editable && (
                <Button
                  size="sm"
                  disabled={!dirty || saving}
                  onClick={handleSave}
                  className="h-8 rounded-full px-4 font-semibold"
                >
                  {saving ? <Loader2Icon className="size-4 animate-spin" /> : "Save changes"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const DocumentAttachmentChip: FC<{ isComposer: boolean }> = ({ isComposer }) => {
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
        isComposer={isComposer}
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
        <DocumentAttachmentChip isComposer={isComposer} />
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
