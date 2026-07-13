"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { renderConnectorIcon } from "@/lib/connectors/icons";
import { SearchIcon, Loader2Icon, XIcon, LinkIcon, UnplugIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const KNOWN_ICON_IDS = new Set([
  "linear","atlassian","trello","airtable","notion",
  "slack","github","google","hubspot","asana","dropbox",
]);

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

export function ConnectorsTab() {
  const [query, setQuery] = useState("");
  const [connectors, setConnectors] = useState<DisplayConnector[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<DisplayConnector | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/connectors/list");
      const data = await res.json();
      setConnectors(data.connectors || []);
    } catch {}
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
      const res = await fetch("/api/connectors/link", {
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
        const w = Math.min(600, screen.width);
        const h = Math.min(700, screen.height);
        const left = (screen.width - w) / 2;
        const top = (screen.height - h) / 2;
        window.open(
          data.redirectUrl,
          `connect-${connectorId}`,
          `width=${w},height=${h},left=${left},top=${top},popup=1`,
        );

        const pollInterval = setInterval(async () => {
          try {
            const res = await fetch("/api/connectors/list");
            const data = await res.json();
            const match = (data.connectors || []).find((c: any) => c.id === connectorId);
            if (match?.connected) {
              clearInterval(pollInterval);
              setConnectors(data.connectors);
              setConnectingId((prev) => (prev === connectorId ? null : prev));
              setStatusMsg("Connected!");
            }
          } catch {}
        }, 2000);

        setTimeout(() => {
          clearInterval(pollInterval);
          setConnectingId((prev) => (prev === connectorId ? null : prev));
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
      await fetch("/api/connectors/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectorId }),
      });
      await fetchData();
      setStatusMsg("Disconnected");
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
    <motion.div
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 0.2 }}
      className="flex-1 flex flex-col overflow-hidden"
    >
      <div className="flex-1 overflow-y-auto pr-1">
        <div className="space-y-1 mb-4">
          <h3 className="text-base font-semibold tracking-tight">Connectors</h3>
          <p className="text-xs text-muted-foreground">
            Connect Qube to external services via Composio.
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

        <div className="flex flex-wrap gap-3 pt-1">
          {filtered.map((connector) => {
            const isConnected = connector.connected;
            const isConnecting = connectingId === connector.id;

            return (
              <div
                key={connector.id}
                onClick={() => {
                  if (isConnecting) return;
                  if (isConnected) {
                    setDisconnectTarget(connector);
                  } else {
                    handleConnect(connector.id);
                  }
                }}
                className={cn(
                  "flex flex-col items-center justify-center size-[72px] rounded-2xl border transition-all text-center p-1.5 gap-1 relative select-none",
                  !isConnected && "cursor-pointer hover:scale-105 active:scale-95 bg-background hover:bg-muted/30",
                  isConnected && "cursor-pointer hover:scale-105 active:scale-95 border-emerald-500/40 hover:border-red-500/50",
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
      </div>

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
    </motion.div>
  );
}
