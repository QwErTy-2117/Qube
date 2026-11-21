// Single place that describes the documentation website.
//
// The Markdown files under ../docs, ../TERMS.md and ../PRIVACY.md stay the
// source of truth (they are readable on GitHub as-is). `scripts/sync-content.mjs`
// copies them into ./content/docs according to the map below, adds front
// matter, and rewrites links so they work on the website.

export const site = {
  name: 'Qube',
  tagline: 'An AI agent for anyone.',
  subtitle:
    'A free, open-source, local-first desktop assistant that does the work instead of just suggesting it — no terminal, no server to manage, no Qube subscription.',
  // Verified from `git remote -v` and src-tauri/tauri.conf.json (updater endpoint).
  repoUrl: 'https://github.com/QwErTy-2117/Qube',
  branch: 'main',
};

/**
 * Sections become sidebar tabs. `from` is relative to the repository root,
 * `to` is the slug inside the section (no extension).
 */
export const sections = [
  {
    dir: 'user',
    title: 'User guide',
    description: 'Install Qube, connect an AI, and get everyday work done.',
    pages: [
      { from: 'docs/getting-started.md', to: 'getting-started' },
      { from: 'docs/ai-providers.md', to: 'ai-providers' },
      { from: 'docs/conversations.md', to: 'conversations' },
      { from: 'docs/files-workspace.md', to: 'files-workspace' },
      { from: 'docs/web-research.md', to: 'web-research' },
      { from: 'docs/browser.md', to: 'browser' },
      { from: 'docs/computer-use.md', to: 'computer-use' },
      { from: 'docs/connectors.md', to: 'connectors' },
      { from: 'docs/memory-and-skills.md', to: 'memory-and-skills' },
      { from: 'docs/automations.md', to: 'automations' },
      { from: 'docs/permissions-privacy.md', to: 'permissions-privacy' },
      { from: 'docs/desktop.md', to: 'desktop' },
      { from: 'docs/mcp.md', to: 'mcp' },
      { from: 'docs/troubleshooting.md', to: 'troubleshooting' },
    ],
  },
  {
    dir: 'developer',
    title: 'Developer docs',
    description: 'Architecture, configuration, integrations and contributing.',
    pages: [
      { from: 'docs/development.md', to: 'development' },
      { from: 'docs/architecture.md', to: 'architecture' },
      { from: 'docs/configuration.md', to: 'configuration' },
      { from: 'docs/acp.md', to: 'acp' },
      { from: 'docs/agent-harness-implementation.md', to: 'agent-harness-implementation' },
      { from: 'docs/agent-harness-architecture-comparison.md', to: 'agent-harness-architecture-comparison' },
      { from: 'docs/docs-site.md', to: 'docs-site' },
      { from: 'docs/maintainability-audit.md', to: 'maintainability-audit' },
      {
        folder: 'design-history',
        title: 'Design history',
        pages: [
          { from: 'docs/superpowers/README.md', to: 'index' },
          { from: 'docs/superpowers/specs/2026-10-29-task-board-and-tool-titles-design.md', to: 'task-board-and-tool-titles-design' },
          { from: 'docs/superpowers/plans/2026-10-29-board-done-status.md', to: 'board-done-status' },
          { from: 'docs/superpowers/plans/2026-10-29-none-schedule-tasks.md', to: 'none-schedule-tasks' },
          { from: 'docs/superpowers/plans/2026-10-29-ai-task-drafts-dialog.md', to: 'ai-task-drafts-dialog' },
          { from: 'docs/superpowers/plans/2026-10-29-tool-group-titles.md', to: 'tool-group-titles' },
        ],
      },
    ],
  },
  {
    dir: 'legal',
    title: 'Legal',
    description: 'Terms of Service, Privacy Policy and the open legal review items.',
    pages: [
      { from: 'TERMS.md', to: 'terms' },
      { from: 'PRIVACY.md', to: 'privacy' },
      { from: 'docs/legal-review-checklist.md', to: 'legal-review-checklist' },
    ],
  },
];

/** The docs landing page (/docs/). */
export const indexPage = { from: 'docs/README.md' };

/** Binary assets copied (not committed twice) from the app's public/ folder. */
export const assets = [
  { from: 'public/logo.png', to: 'assets/logo.png' },
  { from: 'public/qube-demo.gif', to: 'assets/qube-demo.gif' },
];
