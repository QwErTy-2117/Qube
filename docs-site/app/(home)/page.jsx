import Link from 'next/link';
import { site } from '@/site.config.mjs';
import { basePath } from '@/lib/base-path';

// Every claim below is backed by the codebase; see the linked guide for details.
const features = [
  {
    title: 'Does the work',
    body: 'Reads and writes files, runs commands in its own workspace, and makes real Word, Excel and PowerPoint files — with built-in viewers for those and PDFs.',
    href: '/docs/user/files-workspace/',
  },
  {
    title: 'Researches the web',
    body: 'Credential-free web search and page reading, with sources, so answers come with links.',
    href: '/docs/user/web-research/',
  },
  {
    title: 'Uses a real browser',
    body: 'Drives a managed Chrome/Chromium window you can watch, and hands control back to you for logins and captchas.',
    href: '/docs/user/browser/',
  },
  {
    title: 'Works with your apps',
    body: 'Gmail, Calendar, Drive, Slack, GitHub, Notion, Linear, Jira and more through connectors, with sends and deletes checked first.',
    href: '/docs/user/connectors/',
  },
  {
    title: 'Remembers and learns',
    body: 'Local long-term memory, searchable past chats, and skills — reusable playbooks it can apply or create.',
    href: '/docs/user/memory-and-skills/',
  },
  {
    title: 'Keeps working',
    body: 'Scheduled tasks and a periodic check-in (heartbeat) carry work forward while the app is open, and stop before anything final.',
    href: '/docs/user/automations/',
  },
  {
    title: 'Asks before the risky stuff',
    body: 'Hard limits, an invisible reviewer and approval cards gate deletes, sends and anything outside the workspace.',
    href: '/docs/user/permissions-privacy/',
  },
  {
    title: 'Your choice of AI',
    body: 'Sign in with ChatGPT, bring a key for one of 40+ provider presets, or run local models with Ollama or LM Studio.',
    href: '/docs/user/ai-providers/',
  },
];

const paths = [
  {
    title: 'User guide',
    body: 'Install the app, pick an AI, and learn what Qube can do for you.',
    href: '/docs/user/getting-started/',
  },
  {
    title: 'Developer docs',
    body: 'Build from source, understand the architecture, configure and extend Qube.',
    href: '/docs/developer/development/',
  },
  {
    title: 'Legal',
    body: 'Terms of Service, Privacy Policy and the open legal review checklist.',
    href: '/docs/legal/terms/',
  },
];

export default function HomePage() {
  return (
    <main className="qd-home">
      <section className="qd-hero">
        <img className="qd-hero-logo" src={`${basePath}/assets/logo.png`} alt="Qube logo" width={88} height={88} />
        <h1>{site.tagline}</h1>
        <p className="qd-subtitle">{site.subtitle}</p>
        <div className="qd-actions">
          <a className="qd-button qd-button-primary" href={`${site.repoUrl}/releases`}>
            Download
          </a>
          <Link className="qd-button" href="/docs/user/getting-started/">
            Get started
          </Link>
          <a className="qd-button" href={site.repoUrl}>
            Source on GitHub
          </a>
        </div>
        <p className="qd-platforms">Windows · macOS · Linux — free and open source (Apache 2.0)</p>
      </section>

      <section className="qd-demo">
        <img src={`${basePath}/assets/qube-demo.gif`} alt="Qube completing a task in the desktop app" loading="lazy" />
      </section>

      <section className="qd-section">
        <h2>What Qube does</h2>
        <div className="qd-grid">
          {features.map((f) => (
            <Link key={f.title} href={f.href} className="qd-card">
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="qd-section">
        <h2>Find your way</h2>
        <div className="qd-grid qd-grid-3">
          {paths.map((p) => (
            <Link key={p.title} href={p.href} className="qd-card qd-card-path">
              <h3>{p.title} →</h3>
              <p>{p.body}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
