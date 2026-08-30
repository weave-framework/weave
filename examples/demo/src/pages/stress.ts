/**
 * A perf stress route — the target for the C-phase reconcile benchmark.
 *
 * It drives a large keyed `@for` through the classic js-framework-benchmark ops
 * (create / append / update-every-10th / swap / shuffle / remove / clear) and
 * times each one. Because Weave's reactive updates are SYNCHRONOUS (the DOM is
 * current the moment a `batch` returns), wrapping the mutation in `batch` and
 * reading `performance.now()` on either side measures the real reconcile cost —
 * no `tick()` round-trip needed.
 */

import { signal, batch, type Signal } from '@weave-framework/runtime';

export interface Row {
  id: number;
  label: string;
}

export interface StressSetup {
  rows: Signal<Row[]>;
  selected: Signal<number | null>;
  lastOp: Signal<string>;
  lastMs: Signal<string>;
  create: (n: number) => void;
  append: (n: number) => void;
  updateEvery10: () => void;
  swapRows: () => void;
  shuffle: () => void;
  remove: (id: number) => void;
  select: (id: number) => void;
  clear: () => void;
}

const ADJECTIVES: string[] = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long', 'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy', 'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive', 'cheap', 'expensive', 'fancy'];
const COLOURS: string[] = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple', 'white', 'black', 'orange'];
const NOUNS: string[] = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie', 'sandwich', 'burger', 'pizza', 'mouse', 'keyboard'];

const pick = (xs: string[]): string => xs[Math.floor(Math.random() * xs.length)];

let nextId: number = 1;

/** Build `n` rows with fresh monotonic ids — ids are the `@for` track key. */
function buildRows(n: number): Row[] {
  const out: Row[] = new Array(n);
  for (let i: number = 0; i < n; i++) {
    out[i] = { id: nextId++, label: `${pick(ADJECTIVES)} ${pick(COLOURS)} ${pick(NOUNS)}` };
  }
  return out;
}

/** The benchmark route (path `stress`) — a control panel over a heavy keyed list. */
export function setup(): StressSetup {
  const rows: Signal<Row[]> = signal<Row[]>([]);
  const selected: Signal<number | null> = signal<number | null>(null);
  const lastOp: Signal<string> = signal<string>('—');
  const lastMs: Signal<string> = signal<string>('—');

  /** Run a mutation inside a `batch` and record how long the sync reconcile took. */
  function timed(op: string, fn: () => void): void {
    const t0: number = performance.now();
    batch(fn);
    const dt: number = performance.now() - t0;
    lastOp.set(op);
    lastMs.set(dt.toFixed(1));
  }

  const create = (n: number): void => timed(`create ${n}`, () => {
    selected.set(null);
    rows.set(buildRows(n));
  });

  const append = (n: number): void => timed(`append ${n}`, () => {
    rows.set((xs) => [...xs, ...buildRows(n)]);
  });

  const updateEvery10 = (): void => timed('update every 10th', () => {
    rows.set((xs) => xs.map((r, i) => (i % 10 === 0 ? { ...r, label: r.label + ' !!!' } : r)));
  });

  const swapRows = (): void => timed('swap rows', () => {
    rows.set((xs) => {
      if (xs.length < 999) return xs;
      const next: Row[] = xs.slice();
      const a: Row = next[1];
      next[1] = next[998];
      next[998] = a;
      return next;
    });
  });

  const shuffle = (): void => timed('shuffle', () => {
    rows.set((xs) => {
      const next: Row[] = xs.slice();
      for (let i: number = next.length - 1; i > 0; i--) {
        const j: number = Math.floor(Math.random() * (i + 1));
        const tmp: Row = next[i];
        next[i] = next[j];
        next[j] = tmp;
      }
      return next;
    });
  });

  const remove = (id: number): void => timed('remove row', () => {
    rows.set((xs) => xs.filter((r) => r.id !== id));
  });

  const select = (id: number): void => {
    selected.set(id);
  };

  const clear = (): void => timed('clear', () => {
    selected.set(null);
    rows.set([]);
  });

  return { rows, selected, lastOp, lastMs, create, append, updateEvery10, swapRows, shuffle, remove, select, clear };
}
