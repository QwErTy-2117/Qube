import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import "@fontsource/caveat/600.css";
import { Provider } from "./provider";
import { Titlebar } from "@/components/tauri/titlebar";
import { AgentRuntimeProvider } from "@/components/assistant-ui/agent-runtime-provider";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Qube",
  description: "Qube",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    images: "/logo.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${GeistSans.className} ${GeistMono.variable} antialiased`}>
        <Titlebar />
        <Provider>
          <AgentRuntimeProvider>
            <AppShell>{children}</AppShell>
          </AgentRuntimeProvider>
        </Provider>
      </body>
    </html>
  );
}