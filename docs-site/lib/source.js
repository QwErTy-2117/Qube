import { docs } from '@/.source/server';
import { loader } from 'fumadocs-core/source';
import { sections, indexPage, site } from '@/site.config.mjs';

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});

// content-relative path (e.g. "user/ai-providers.md") -> repository source file,
// used for the "Edit on GitHub" button so edits land in the real source.
const sourceFiles = new Map([['index.md', indexPage.from]]);
for (const section of sections) {
  for (const entry of section.pages) {
    if (entry.folder) {
      for (const p of entry.pages) sourceFiles.set(`${section.dir}/${entry.folder}/${p.to}.md`, p.from);
    } else {
      sourceFiles.set(`${section.dir}/${entry.to}.md`, entry.from);
    }
  }
}

export function editUrl(page) {
  const from = sourceFiles.get(page.path);
  return from ? `${site.repoUrl}/edit/${site.branch}/${from}` : undefined;
}
