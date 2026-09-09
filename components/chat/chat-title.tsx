"use client";

import { useState, type FC } from "react";
import { useThreadStore } from "@/lib/chat/thread-store";
import { isPlaceholderTitle } from "@/lib/chat/threads-client";
import { CheckIcon, XIcon } from "lucide-react";

/**
 * Top-left chat name. Hidden until the chat actually starts (first messages
 * or a real title); click to rename afterwards.
 */
export const ChatTitle: FC = () => {
  const selectedId = useThreadStore((s) => s.selectedId);
  const threads = useThreadStore((s) => s.threads);
  const rename = useThreadStore((s) => s.rename);

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const meta = threads.find((t) => t.id === selectedId);
  const title = meta?.title || "New Chat";
  const started = !!meta && (!!meta.hasMessages || !isPlaceholderTitle(meta.title));

  if (!started && !editing) {
    // Keep the header height stable, but show no title on fresh chats.
    return <div className="flex h-12 shrink-0 items-center px-4" aria-hidden />;
  }

  if (editing) {
    return (
      <div className="flex h-12 shrink-0 items-center gap-1 px-4">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && selectedId) {
              if (value.trim()) rename(selectedId, value);
              setEditing(false);
            }
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={() => {
            if (selectedId && value.trim() && value.trim() !== title) rename(selectedId, value);
            setEditing(false);
          }}
          className="h-7 w-64 rounded border border-border bg-background px-2 text-sm font-medium outline-none"
        />
        <button
          aria-label="Confirm rename"
          onMouseDown={(e) => {
            e.preventDefault();
            if (selectedId && value.trim()) rename(selectedId, value);
            setEditing(false);
          }}
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <CheckIcon className="size-3.5" />
        </button>
        <button
          aria-label="Cancel rename"
          onMouseDown={(e) => {
            e.preventDefault();
            setEditing(false);
          }}
          className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-12 shrink-0 items-center px-4">
      <button
        onClick={() => {
          setValue(isPlaceholderTitle(title) ? "" : title);
          setEditing(true);
        }}
        title="Rename chat"
        className="max-w-[320px] truncate rounded px-1 py-0.5 text-left text-sm font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground"
      >
        {title}
      </button>
    </div>
  );
};
