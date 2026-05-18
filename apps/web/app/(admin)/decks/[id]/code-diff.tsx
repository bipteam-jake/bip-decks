'use client';

// CodeDiff — renders a unified `git diff` string as a side-by-side HTML
// diff using diff2html. Lazy-loaded via next/dynamic from deck-editor.tsx
// so the diff2html JS and CSS only ship when the user opens the Code tab.

import { useEffect, useState } from 'react';
import { html as renderDiffHtml } from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';

interface Props {
  jobId: string;
}

export function CodeDiff({ jobId }: Props) {
  const [state, setState] = useState<
    { kind: 'loading' } | { kind: 'ok'; html: string } | { kind: 'error'; message: string }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ai/jobs/${jobId}/diff`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `Diff fetch failed (${res.status})`);
        }
        const body = (await res.json()) as { diff: string };
        if (cancelled) return;
        const rendered = renderDiffHtml(body.diff, {
          drawFileList: false,
          outputFormat: 'side-by-side',
          matching: 'lines',
        });
        setState({ kind: 'ok', html: rendered });
      } catch (err) {
        if (!cancelled) setState({ kind: 'error', message: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (state.kind === 'loading') {
    return <div className="p-4 text-xs text-neutral-500">Loading diff…</div>;
  }
  if (state.kind === 'error') {
    return <div className="p-4 text-xs text-red-700">{state.message}</div>;
  }
  // diff2html-rendered HTML is trusted (server-controlled git diff text).
  // eslint-disable-next-line react/no-danger
  return <div className="p-2 text-xs" dangerouslySetInnerHTML={{ __html: state.html }} />;
}
