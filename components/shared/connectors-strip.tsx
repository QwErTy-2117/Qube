"use client";

import { useState, useEffect } from "react";
import { renderConnectorIcon } from "@/lib/connectors/icons";
import { prefetchConnectors } from "@/lib/connectors/connectors-cache";

// Most-used connectors: Gmail, Slack, GitHub, Notion, Trello.
type Featured = { id: string; label: string; tilt: number };
const FEATURED: Featured[] = [
  { id: "gmail", label: "Gmail", tilt: -8 },
  { id: "slack", label: "Slack", tilt: 6 },
  { id: "github", label: "GitHub", tilt: -5 },
  { id: "notion", label: "Notion", tilt: 7 },
  { id: "trello", label: "Trello", tilt: -6 },
];

/** Official Gmail (2020) mark — multicolor envelope, vendored paths. */
function GmailIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="52 42 88 66"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="#4285f4" d="M58 108h14V74L52 59v43c0 3.32 2.69 6 6 6" />
      <path fill="#34a853" d="M120 108h14c3.32 0 6-2.69 6-6V59l-20 15" />
      <path fill="#fbbc04" d="M120 48v26l20-15v-8c0-7.42-8.47-11.65-14.4-7.2" />
      <path fill="#ea4335" d="M72 74V48l24 18 24-18v26L96 92" />
      <path fill="#c5221f" d="M52 51v8l20 15V48l-5.6-4.2c-5.94-4.45-14.4-.22-14.4 7.2" />
    </svg>
  );
}

/** Official Trello board mark — blue gradient squircle, vendored path. */
function TrelloIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="qube-trello-bg" x1="50%" x2="50%" y1="100%" y2="0%">
          <stop offset="0" stopColor="#0052cc" />
          <stop offset="1" stopColor="#2684ff" />
        </linearGradient>
      </defs>
      <g fill="none" fillRule="evenodd">
        <path
          d="m55.59.07h-47.59c-4.09405078 0-7.41448241 3.31595294-7.42006073 7.41v47.52c-.00791682 1.9730991.77030774 3.8681213 2.16269326 5.2661365 1.39238553 1.3980151 3.28425224 2.1838635 5.25736747 2.1838635h47.59c1.9713817-.0026407 3.8606757-.7896772 5.250897-2.1874031s2.1670753-3.2912295 2.1591638-5.2625969v-47.52c-.0055694-4.09014608-3.3199147-7.40449138-7.4100608-7.41zm-28.09 44.93c-.0026377.6594819-.2678382 1.2907542-.7369724 1.7542587-.4691341.4635046-1.1035619.721065-1.7630276.7158222h-10.4c-1.3602365-.005588-2.46-1.1098333-2.46-2.4700809v-30.95c0-1.3602476 1.0997635-2.4644929 2.46-2.47h10.4c1.3618668.0054804 2.4645196 1.1081332 2.47 2.47zm24-14.21c0 .6603158-.2642968 1.2931595-.7340204 1.7572465-.4697237.464087-1.1057125.7207735-1.7659796.7129359h-10.4c-1.3618668-.0056628-2.4645196-1.1083156-2.47-2.4701824v-16.74c.0054804-1.3618668 1.1081332-2.4645196 2.47-2.47h10.4c1.3602365.0055071 2.4600111 1.1097524 2.46 2.47z"
          fill="url(#qube-trello-bg)"
        />
      </g>
    </svg>
  );
}

function FeaturedIcon({ id }: { id: string }) {
  if (id === "gmail") return <GmailIcon size={15} />;
  if (id === "trello") return <TrelloIcon size={15} />;
  return <>{renderConnectorIcon(id, 15)}</>;
}

function openConnectorsSettings(connectorId?: string) {
  try {
    window.dispatchEvent(
      new CustomEvent("qube-open-settings", { detail: { tab: "connectors", connectorId } })
    );
  } catch {}
}

/**
 * Tray that slides out from under the home-page composer: favourite
 * connector icons (tilted, overlapping) that open the connectors settings
 * tab. Hovering a tile straightens it while its neighbours shift away.
 */
export function ConnectorsStrip() {
  const [hovered, setHovered] = useState<number | null>(null);

  // Warm the connectors cache while the landing page is visible so the
  // settings / onboarding tabs open instantly instead of spinner-first.
  useEffect(() => {
    prefetchConnectors();
  }, []);

  return (
    <div className="relative z-0 -mt-5 w-full px-5">
      <div className="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 rounded-2xl border border-border/60 bg-muted/40 px-3 pt-5 pb-1.5">
        <span className="text-xs font-semibold whitespace-nowrap text-foreground">
          Connect your favourite{" "}
          <span
            className="font-hand text-lg leading-none"
            style={{ fontFamily: '"Caveat", "Segoe Script", "Bradley Hand", cursive' }}
          >
            apps
          </span>
        </span>
        <div className="flex items-center py-1">
          {FEATURED.map((c, i) => {
            const isHovered = hovered === i;
            const push = hovered === null || isHovered ? 0 : i < hovered ? -6 : 6;
            return (
              <button
                key={c.id}
                type="button"
                title={`Connect ${c.label}`}
                onClick={() => openConnectorsSettings(c.id)}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                style={{
                  transform: `rotate(${isHovered ? 0 : c.tilt}deg) translateX(${push}px)`,
                }}
                className={
                  "relative flex size-8 cursor-pointer items-center justify-center rounded-lg border border-border/70 bg-background shadow-sm transition-transform duration-200 hover:scale-110 hover:z-10 " +
                  (i > 0 ? "-ml-2" : "")
                }
              >
                <FeaturedIcon id={c.id} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
