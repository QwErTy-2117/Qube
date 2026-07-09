"use client";

import { type PropsWithChildren, useEffect, useState, type FC } from "react";
import { XIcon, PlusIcon, FileText } from "lucide-react";
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
  DialogContent,
  DialogTrigger,
} from "@/components/ui/dialog";
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
        className="aui-attachment-tile-remove text-muted-foreground hover:[&_svg]:text-destructive absolute end-1.5 top-1.5 size-3.5 rounded-full bg-white opacity-0 shadow-sm transition-all duration-150 group-hover:opacity-100 hover:!size-5 hover:-translate-x-[0.1875rem] hover:-translate-y-[0.1875rem] hover:bg-white! [&_svg]:size-3 hover:[&_svg]:size-3.5 [&_svg]:text-black"
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
