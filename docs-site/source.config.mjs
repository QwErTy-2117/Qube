import { defineConfig, defineDocs } from 'fumadocs-mdx/config';
import { remarkMdxMermaid } from 'fumadocs-core/mdx-plugins';

export const docs = defineDocs({ dir: 'content/docs' });

export default defineConfig({
  mdxOptions: {
    // ```mermaid code blocks -> <Mermaid chart="..." /> (components/mermaid.jsx)
    remarkPlugins: [remarkMdxMermaid],
  },
});
