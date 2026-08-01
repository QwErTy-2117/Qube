"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function Provider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider attribute="class" defaultTheme="light" scriptProps={{ async: true }}>
      {children}
    </NextThemesProvider>
  );
}
