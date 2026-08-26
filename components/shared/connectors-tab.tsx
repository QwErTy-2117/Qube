"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { renderConnectorIcon } from "@/lib/connectors/icons";
import { SearchIcon, Loader2Icon, XIcon, LinkIcon, UnplugIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

async function openUrl(url: string) {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

const KNOWN_ICON_IDS = new Set([
  "linear","atlassian","trello","airtable","notion",
  "slack","github","google","hubspot","asana","dropbox",
]);

const TOOLKIT_SLUGS: Record<string, string[]> = {
  linear: ["linear"],
  atlassian: ["jira"],
  trello: ["trello"],
  airtable: ["airtable"],
  notion: ["notion"],
  slack: ["slack"],
  github: ["github"],
  google: ["gmail", "googlecalendar", "googledrive"],
  hubspot: ["hubspot"],
  asana: ["asana"],
  dropbox: ["dropbox"],
};

interface DisplayConnector {
  id: string;
  name: string;
  description: string;
  brandColor: string;
  icon: string;
  hasIcon: boolean;
  appUrl: string;
  connected: boolean;
}

function getInstanceId(): string {
  if (typeof window === "undefined") return "qube-default-user";
  return localStorage.getItem("qube-instance-id") || "qube-default-user";
}

export function ConnectorsTab() {
  const [query, setQuery] = useState("");
  const [connectors, setConnectors] = useState<DisplayConnector[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<DisplayConnector | null>(null);
  const [detailConnector, setDetailConnector] = useState<DisplayConnector | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`/api/connectors/list?instanceId=${getInstanceId()}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setConnectors(data.connectors || []);
    } catch (e) {
      console.error("[connectors] fetchData failed", e);
      setConnectors([]);
    }
  }, []);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  useEffect(() => {
    if (!statusMsg) return;
    const t = setTimeout(() => setStatusMsg(null), 4000);
    return () => clearTimeout(t);
  }, [statusMsg]);

  const handleConnect = useCallback(async (connectorId: string) => {
    setConnectingId(connectorId);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/connectors/link?instanceId=${getInstanceId()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error || "Failed to connect");
        setConnectingId(null);
        return;
      }
      if (data.redirectUrl) {
        openUrl(data.redirectUrl);

        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/connectors/status?instanceId=${getInstanceId()}&connectorId=${connectorId}`);
            const statusData = await statusRes.json();
            const connectedSlugs: string[] = statusData.connected || [];
            const connectorSlugs = TOOLKIT_SLUGS[connectorId] || [connectorId];
            const isConnected = connectorSlugs.some((slug: string) => connectedSlugs.includes(slug));
            if (isConnected) {
              clearInterval(pollInterval);
              await fetchData();
              setConnectingId(null);
            }
          } catch {}
        }, 2000);

        setTimeout(() => {
          clearInterval(pollInterval);
          setConnectingId(null);
        }, 120_000);
      }
    } catch {
      setStatusMsg("Connection failed");
      setConnectingId(null);
    }
  }, [fetchData]);

  const handleDisconnect = useCallback(async (connectorId: string) => {
    setDisconnectTarget(null);
    setConnectingId(connectorId);
    try {
      await fetch(`/api/connectors/disconnect?instanceId=${getInstanceId()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId }),
      });
      await fetchData();

    } catch {}
    setConnectingId(null);
  }, [fetchData]);

  const filtered = query.trim()
    ? connectors.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    : connectors;

  if (loading && connectors.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2Icon className="size-5 animate-spin text-muted-foreground/40" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
      <motion.div
        initial={{ opacity: 0, filter: "blur(4px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        transition={{ duration: 0.2 }}
      >
        <div className="space-y-1 mb-4">
          <h3 className="text-base font-semibold tracking-tight">Connectors</h3>
          <p className="text-xs text-muted-foreground">
            Connect Qube to your favorite external services and tools.
          </p>
        </div>

        <div className="relative mb-4">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/50 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search connectors..."
            className="w-full h-8 rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-ring transition-colors placeholder:text-muted-foreground/40"
          />
        </div>

        {statusMsg && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg border border-border bg-muted/20 text-xs text-foreground/80">
            <span className="flex-1">{statusMsg}</span>
            <button onClick={() => setStatusMsg(null)} className="shrink-0">
              <XIcon className="size-3 text-muted-foreground/50 hover:text-foreground transition-colors" />
            </button>
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-1 justify-center">
          {filtered.map((connector) => {
            const isConnected = connector.connected;
            const isConnecting = connectingId === connector.id;

            return (
              <div
                key={connector.id}
                onClick={() => {
                  if (isConnecting) return;
                  setDetailConnector(connector);
                }}
                className={cn(
                  "flex flex-col items-center justify-center size-[72px] rounded-2xl ring-1 ring-inset transition-all text-center p-1.5 gap-1 relative select-none shadow-md shadow-black/5 dark:shadow-[0_4px_16px_-2px_rgba(255,255,255,0.08)] hover:shadow-lg dark:hover:shadow-[0_6px_20px_-2px_rgba(255,255,255,0.14)]",
                  !isConnected && "cursor-pointer hover:scale-105 active:scale-95 bg-background hover:bg-muted/30 ring-border/50",
                  isConnected && "cursor-pointer hover:scale-105 active:scale-95 ring-emerald-500/40 hover:ring-red-500/50 shadow-emerald-500/20 dark:shadow-[0_4px_16px_-2px_rgba(16,185,129,0.35)] hover:shadow-red-500/20 dark:hover:shadow-[0_4px_16px_-2px_rgba(239,68,68,0.35)]",
                )}
              >
                {isConnecting && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-2xl z-10">
                    <Loader2Icon className="size-5 animate-spin text-muted-foreground/60" />
                  </div>
                )}

                <div
                  className="size-9 flex items-center justify-center shrink-0"
                  style={{ color: connector.brandColor || undefined }}
                >
                  {KNOWN_ICON_IDS.has(connector.id)
                    ? renderConnectorIcon(connector.id, 24)
                    : connector.icon?.startsWith("http")
                      ? <img src={connector.icon} alt="" className="size-6 object-contain" />
                      : <LinkIcon className="size-5 text-muted-foreground/50" />}
                </div>
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground/50 text-center py-8">
            No connectors match "{query}"
          </p>
        )}
      </motion.div>

      <Dialog open={!!disconnectTarget} onOpenChange={(v) => { if (!v) setDisconnectTarget(null); }}>
        <DialogContent className="sm:max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Disconnect {disconnectTarget?.name}</DialogTitle>
            <DialogDescription>
              Are you sure you want to disconnect {disconnectTarget?.name}? The agent will no longer have access to this service.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" className="rounded-full h-8">Cancel</Button>
            </DialogClose>
            <Button
              variant="outline"
              onClick={() => disconnectTarget && handleDisconnect(disconnectTarget.id)}
              className="rounded-full text-red-500 border-red-500/30 hover:bg-red-500/10 flex items-center gap-1.5 px-3 h-8"
            >
              <UnplugIcon className="size-3.5" />
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Connector detail popup — logo in square top-left aligned with dialog corner */}
      <Dialog open={!!detailConnector} onOpenChange={(v) => { if (!v) setDetailConnector(null); }}>
        <DialogContent className="sm:max-w-sm rounded-3xl p-0 overflow-hidden gap-0">
          <DialogHeader className="sr-only">
            <DialogTitle>{detailConnector?.name}</DialogTitle>
            <DialogDescription>{detailConnector?.description}</DialogDescription>
          </DialogHeader>

          {detailConnector && (
            <>
              <div className="flex gap-3 items-start p-5">
                {/* Square with rounded corners container for the image */}
                <div
                  className="size-12 rounded-xl bg-background border border-border/60 flex items-center justify-center shrink-0"
                  style={{ color: detailConnector.brandColor || undefined }}
                >
                  {KNOWN_ICON_IDS.has(detailConnector.id)
                    ? renderConnectorIcon(detailConnector.id, 28)
                    : detailConnector.icon?.startsWith("http")
                      ? <img src={detailConnector.icon} alt="" className="size-7 object-contain" />
                      : <LinkIcon className="size-6 text-muted-foreground/50" />}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-sm font-semibold text-foreground leading-none">{detailConnector.name}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
                    {detailConnector.description || `${detailConnector.name} integration via Composio`}
                  </p>
                  {detailConnector.appUrl && (
                    <a
                      href={detailConnector.appUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-primary hover:underline inline-flex items-center gap-1 mt-1"
                    >
                      Visit site ↗
                    </a>
                  )}
                </div>
              </div>

              <div className="w-fit ml-auto flex items-center gap-2 rounded-full border border-border/60 bg-muted/10 hover:bg-muted/20 transition-colors px-1.5 py-1.5 m-5">
                <button
                  onClick={() => setDetailConnector(null)}
                  type="button"
                  className="flex items-center justify-center size-8 rounded-full text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                  title="Close"
                >
                  <XIcon className="size-4" />
                </button>
                <div className="relative">
                  {detailConnector.connected ? (
                    <Button
                      onClick={() => {
                        setDisconnectTarget(detailConnector);
                        setDetailConnector(null);
                      }}
                      className="rounded-full font-semibold"
                    >
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      onClick={() => {
                        handleConnect(detailConnector.id);
                        setDetailConnector(null);
                      }}
                      disabled={connectingId === detailConnector.id}
                      className="rounded-full font-semibold"
                    >
                      {connectingId === detailConnector.id ? <Loader2Icon className="size-4 animate-spin" /> : null}
                      Connect
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
