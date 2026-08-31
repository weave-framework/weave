import { signal, computed } from '@weave-framework/runtime';
import { fileToRoutes, type FileRoute } from '@weave-framework/router/files';

/**
 * File-based routing, driven by the reader.
 *
 * The textarea uses `bind:value`, not `<textarea>{{ text() }}</textarea>`. The obvious form is the one
 * that does not work: a browser reads a textarea's content as TEXT, so the `<!---->` marker the runtime
 * writes there becomes six literal characters in the value — which this demo then parsed as a filename.
 * The compiler warns about it now; it did not when this was written.
 *
 * `fileToRoutes` is the real function the CLI calls — pure string work, no filesystem — so this is not a
 * simulation of the convention, it IS the convention. Edit the file list and the route table follows,
 * including the two rules that are hard to hold in your head: `_layout` makes a folder a NESTED route,
 * and a folder without one is FLATTENED into its parent with the folder name prefixed.
 */
interface Row {
  depth: number;
  path: string;
  file: string;
}

const DEFAULT = [
  'index.ts',
  'about.ts',
  'blog/_layout.ts',
  'blog/index.ts',
  'blog/[slug].ts',
  'docs/guide.ts',
  '[...rest].ts',
].join('\n');

export function setup() {
  const text = signal(DEFAULT);

  const files = computed((): string[] =>
    text()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  );

  const rows = computed((): Row[] => {
    const out: Row[] = [];
    const walk = (list: FileRoute[], depth: number): void => {
      for (const r of list) {
        out.push({ depth, path: r.path === '' ? "'' (index)" : r.path, file: r.file ?? '(layout only)' });
        if (r.children) walk(r.children, depth + 1);
      }
    };
    try {
      walk(fileToRoutes(files()), 0);
    } catch (e) {
      out.push({ depth: 0, path: '(error)', file: String((e as Error).message).slice(0, 80) });
    }
    return out;
  });

  const reset = (): void => {
    text.set(DEFAULT);
  };
  const indent = (n: number): string => '\u00a0\u00a0'.repeat(n * 2);
}
