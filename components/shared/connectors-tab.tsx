"use client";

import { useState, useEffect, useCallback } from "react";
import { SiGoogle } from "react-icons/si";
import { Loader2Icon, LinkIcon, UnplugIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const GOOGLE_CONNECTOR = {
  id: "google",
  name: "Google",
  description: "Gmail, Calendar, and Drive",
  brandColor: "#4285F4",
  icon: "google",
};

export function ConnectorsTab() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/connectors/google/status");
      const data = await res.json();
      setConnected(data.connected);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!statusMsg) return;
    const t = setTimeout(() => setStatusMsg(null), 3000);
    return () => clearTimeout(t);
  }, [statusMsg]);

  const handleConnect = useCallback(async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const res = await fetch("/api/connectors/google/link", { method: "POST" });
      const data = await res.json();
      if (!data.url) throw new Error("No auth URL returned");

      const popup = window.open(data.url, "google-auth", "width=600,height=700");
      if (!popup) {
        setStatusMsg("Pop-up blocked. Allow pop-ups and try again.");
        setConnecting(false);
        return;
      }

      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch("/api/connectors/google/status");
          const statusData = await statusRes.json();
          if (statusData.connected) {
            clearInterval(pollInterval);
            setConnected(true);
            setConnecting(false);
            setStatusMsg("Google connected!");
            if (!popup.closed) popup.close();
          }
        } catch {}
      }, 2000);

      setTimeout(() => {
        clearInterval(pollInterval);
        setConnecting(false);
      }, 120_000);
    } catch {
      setStatusMsg("Connection failed");
      setConnecting(false);
    }
  }, [connecting]);

  const handleDisconnect = useCallback(async () => {
    setShowDisconnect(false);
    try {
      await fetch("/api/connectors/google/disconnect", { method: "POST" });
      setConnected(false);
      setStatusMsg("Disconnected");
    } catch {}
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <Dialog open={showDisconnect} onOpenChange={setShowDisconnect}>
        <DialogContent className="rounded-3xl max-w-sm">
          <DialogHeader>
            <DialogTitle>Disconnect Google?</DialogTitle>
            <DialogDescription>
              This will revoke access to Gmail, Calendar, and Drive. You can reconnect later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDisconnect}>
              <UnplugIcon className="h-4 w-4 mr-2" />
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap gap-4">
        <button
          onClick={() => connected ? setShowDisconnect(true) : handleConnect()}
          disabled={connecting}
          className={cn(
            "group relative flex flex-col items-center justify-center gap-2 w-28 h-28 rounded-2xl border-2 transition-all duration-200",
            connected
              ? "border-green-500 hover:border-red-500 bg-green-50 dark:bg-green-950/20"
              : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600 bg-white dark:bg-gray-900",
            connecting && "opacity-70 pointer-events-none",
          )}
        >
          {connecting ? (
            <Loader2Icon className="h-8 w-8 animate-spin text-gray-400" />
          ) : (
            <SiGoogle
              className={cn(
                "h-8 w-8 transition-colors",
                connected ? "text-green-600 group-hover:text-red-500" : "text-gray-500 dark:text-gray-400",
              )}
            />
          )}
        </button>
      </div>

      {statusMsg && (
        <div className="text-sm text-center text-gray-600 dark:text-gray-400">{statusMsg}</div>
      )}

      {!loading && !connected && (
        <div className="text-sm text-center text-gray-500 dark:text-gray-400 py-8">
          Connect Google to access Gmail, Calendar, and Drive through the agent.
        </div>
      )}
    </div>
  );
}
