'use client';
import { RootProvider } from 'fumadocs-ui/provider/next';
import SearchDialog from './search';

export function Provider({ children }) {
  return <RootProvider search={{ SearchDialog }}>{children}</RootProvider>;
}
