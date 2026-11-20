import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Exported as a static JSON file at build time (output: 'export').
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source, { language: 'english' });
