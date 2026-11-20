import { Provider } from '@/components/provider';
import { site } from '@/site.config.mjs';
import { basePath } from '@/lib/base-path';
import './global.css';

export const metadata = {
  title: { default: `${site.name} — ${site.tagline}`, template: `%s · ${site.name} docs` },
  description: site.subtitle,
  icons: { icon: `${basePath}/assets/logo.png` },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
