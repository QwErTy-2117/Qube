import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Mermaid } from './mermaid';

export function getMDXComponents(components) {
  return { ...defaultMdxComponents, Mermaid, ...components };
}
