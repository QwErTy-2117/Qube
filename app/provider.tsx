"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import { UpdaterProvider } from "@/components/updater/updater-provider";

export function Provider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" scriptProps={{ async: true }}>
      <UpdaterProvider>{children}</UpdaterProvider>
    </NextThemesProvider>
  );
}
