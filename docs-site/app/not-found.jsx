import Link from 'next/link';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

// Exported as out/404.html, which GitHub Pages serves for unknown paths.
export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="qd-home qd-notfound">
        <h1>Page not found</h1>
        <p>This page doesn’t exist or has moved. Try the search, or start from one of these:</p>
        <div className="qd-actions">
          <Link className="qd-button qd-button-primary" href="/">
            Home
          </Link>
          <Link className="qd-button" href="/docs/">
            Documentation
          </Link>
        </div>
      </main>
    </HomeLayout>
  );
}
