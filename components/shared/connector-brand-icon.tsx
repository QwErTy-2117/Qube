"use client";

import { useState } from "react";
import { LinkIcon } from "lucide-react";
import { renderConnectorIcon } from "@/lib/connectors/icons";
import { composioLogoUrlForIconId, composioLogoDarkClass } from "@/lib/connectors/composio-logo";

/**
 * Static brand-icon ids (offline/error fallback only). Must stay in sync
 * with KNOWN_ICON_IDS in lib/connectors/composio.ts (server) — the
 * Connectors settings tab, the chat tool cards, and the connect-service card
 * all resolve through here so every surface shows the exact same app icon.
 */
export const STATIC_CONNECTOR_ICON_IDS = new Set([
  "linear", "atlassian", "trello", "airtable", "notion",
  "slack", "github", "google", "gmail", "googlecalendar", "googledrive",
  "hubspot", "asana", "dropbox",
  "canva",
]);

/**
 * The exact icon the Connectors settings tab shows for an app: the live
 * Composio logo CDN artwork first (most up-to-date vendor mark), else the
 * cached Composio URL from the connector list, else the static brand mark,
 * else a neutral link placeholder. Static marks are offline/error fallback
 * only — never preferred over Composio artwork.
 */
export function ConnectorBrandIcon({
  id,
  icon,
  brandColor,
  size = 18,
  imgClassName = "size-[18px]",
  linkClassName = "size-5",
}: {
  id: string;
  icon?: string;
  brandColor?: string;
  size?: number;
  imgClassName?: string;
  linkClassName?: string;
}) {
  const [imgFailed, setImgFailed] = useState(false);

  // Primary: cached Composio logo URL from the connector list (covers the
  // live catalog logo when available, else the CDN fallback the server put
  // there). Secondary: direct Composio CDN URL for the icon id — works even
  // before the list has ever been fetched (e.g. Gmail / Calendar / Drive
  // tool tiles on first load). Static marks are last-resort fallback only.
  const cachedUrl = icon && icon.startsWith("http") ? icon : null;
  const composioUrl = imgFailed ? null : (cachedUrl || composioLogoUrlForIconId(id));

  if (composioUrl && !imgFailed) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={composioUrl}
        alt=""
        className={`${imgClassName} object-contain${composioLogoDarkClass(id)}`}
        loading="lazy"
        onError={() => setImgFailed(true)}
      />
    );
  }

  if (STATIC_CONNECTOR_ICON_IDS.has(id)) {
    const node = renderConnectorIcon(id, size);
    if (node) {
      return (
        <span
          className="flex items-center justify-center"
          style={brandColor ? { color: brandColor } : undefined}
        >
          {node}
        </span>
      );
    }
  }
  return <LinkIcon className={`${linkClassName} text-muted-foreground/50`} />;
}
