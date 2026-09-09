"use client";

import { memo, type FC } from "react";
import type { TextMessagePartComponent } from "@assistant-ui/react";
import type { Unstable_DirectiveFormatter } from "@assistant-ui/react";
import { unstable_defaultDirectiveFormatter } from "@assistant-ui/react";
import { Badge } from "./badge";

type IconComponent = FC<{ className?: string }>;

export type CreateDirectiveTextOptions = {
  /** Maps a directive `type` to an icon component. */
  iconMap?: Record<string, IconComponent>;
  /** Icon rendered when `iconMap` has no entry for the segment type. */
  fallbackIcon?: IconComponent;
};

/** Creates a `Text` message part component that parses directive syntax and renders inline chips. */
export function createDirectiveText(
  formatter: Unstable_DirectiveFormatter,
  options?: CreateDirectiveTextOptions,
): TextMessagePartComponent {
  const iconMap = options?.iconMap;
  const fallbackIcon = options?.fallbackIcon;

  const Component: TextMessagePartComponent = ({ text }) => {
    // Leading "[workspace kind path]" context header (sent by the document
    // popup composer) renders as a file badge instead of raw text.
    let badge: string | null = null;
    let rest = text;
    const m = /^\[workspace ([^\]\n]+)\]\s*\n?/.exec(text);
    if (m) {
      badge = m[1].replace(/\s+id=\S+$/, "").trim();
      rest = text.slice(m[0].length);
    }

    const segments = formatter.parse(rest);

    const badgeEl = badge ? (
      <Badge
        variant="info"
        size="sm"
        data-slot="workspace-context-badge"
        className="mb-1.5"
        aria-label={`Workspace context: ${badge}`}
      >
        {badge}
      </Badge>
    ) : null;

    if (segments.length === 1 && segments[0]!.kind === "text") {
      return (
        <>
          {badgeEl}
          {rest}
        </>
      );
    }

    return (
      <>
        {badgeEl}
        {segments.map((seg, i) => {
          if (seg.kind === "text") {
            return (
              <span key={i} className="whitespace-pre-wrap">
                {seg.text}
              </span>
            );
          }

          const Icon = iconMap?.[seg.type] ?? fallbackIcon;
          return (
            <Badge
              key={i}
              variant="info"
              size="sm"
              data-slot="directive-text-chip"
              data-directive-type={seg.type}
              data-directive-id={seg.id}
              aria-label={`${seg.type}: ${seg.label}`}
              className="aui-directive-chip items-baseline text-[13px] leading-none [&_svg]:self-center"
            >
              {Icon && <Icon />}
              {seg.label}
            </Badge>
          );
        })}
      </>
    );
  };
  Component.displayName = "DirectiveText";
  return Component;
}

const DirectiveTextImpl = createDirectiveText(
  unstable_defaultDirectiveFormatter,
);

/** `Text` message part component that renders directive syntax as inline chips. */
export const DirectiveText: TextMessagePartComponent = memo(DirectiveTextImpl);
