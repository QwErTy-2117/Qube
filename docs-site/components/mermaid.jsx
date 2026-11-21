'use client';
import { useEffect, useId, useState } from 'react';
import { useTheme } from 'next-themes';

// Renders ```mermaid blocks in the browser (static export has no server).
// The source text stays visible until the diagram is ready or if it fails.
export function Mermaid({ chart }) {
  const id = 'mermaid-' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          fontFamily: 'inherit',
          theme: resolvedTheme === 'dark' ? 'dark' : 'default',
        });
        const result = await mermaid.render(id, chart);
        if (alive) setSvg(result.svg);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [chart, id, resolvedTheme]);

  if (!svg || failed) {
    return (
      <pre className="qd-mermaid-fallback" aria-busy={!failed}>
        <code>{chart}</code>
      </pre>
    );
  }
  return <div className="qd-mermaid" role="img" dangerouslySetInnerHTML={{ __html: svg }} />;
}
