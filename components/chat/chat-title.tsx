"use client";

import { useState, type FC } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { CheckIcon, XIcon } from "lucide-react";

/**
 * Top-left chat name. Hidden while the thread is still new (unstarted);
 * click to rename afterwards (persists server-side via the thread adapter).
 */
export const ChatTitle: FC = () => {
  const aui = useAui();
  const item = useAuiState((s) => (s as any).threadListItem as
    | { id: string; title?: string; status?: string }
    | undefined);

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const title = item?.title || "New Chat";
  const started = !!item && item.status !== "new";

  if (!started && !editing) {
    // Keep the header height stable, but show no title on fresh chats.
    return <div className="flex h-12 shrink-0 items-center px-4" aria-hidden />;
  }

  const commit = (v: string) => {
    try {
      if (v.trim())
        Promise.resolve(
          aui.threadListItem().rename(v.trim().slice(0, 120)),
        ).catch(() => {});
    } catch {}
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex h-12 shrink-0 items-center gap-1 px-4">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(value);
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={() => {
            if (value.trim() && value.trim() !== title) commit(value);
            else setEditing(false);
          }}
          className="h-7 w-64 rounded border border-border bg-background px-2 text-sm font-medium outline-none"
        />
        <button
          aria-label="Confirm rename"
          onMouseDown={(e) => {
            e.preventDefault();
            commit(value);
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
          setValue(title === "New Chat" ? "" : title);
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
