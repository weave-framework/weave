import { computed, signal, type Computed, type Signal } from '@weave-framework/runtime';
import type { Unit, Workspace } from '../../../src/detect.js';

/** What the screen is doing. `scanning` is the only state that makes the reader wait. */
export type Phase = 'idle' | 'scanning' | 'done' | 'failed';

/** The session token the service printed into the URL. Every `/api/*` call carries it. */
function sessionToken(): string {
  return new URLSearchParams(location.search).get('token') ?? '';
}

/** Stand-in for "nothing scanned yet", so the template never handles null. */
const EMPTY: Workspace = { root: '', signals: [], units: [], scannedDepth: 0 };

export function setup(): {
  path: Signal<string>;
  phase: Signal<Phase>;
  found: Computed<Workspace>;
  hasResult: Computed<boolean>;
  error: Signal<string>;
  elapsed: Signal<number>;
  picked: Signal<string[]>;
  scan: () => void;
  toggle: (unit: Unit) => void;
  isPicked: (unit: Unit) => boolean;
  relative: (unit: Unit) => string;
  typeLabel: (unit: Unit) => string;
} {
  const path: Signal<string> = signal('');
  // `@if (workspace(); as found)` would read better, but `weave check` emits the alias as a SECOND call inside
  // the if — `if (workspace()) { const found = (workspace()); }` — and TypeScript never narrows a call result,
  // so `found` stays nullable and every use is an error. The runtime compiles the same alias correctly (one
  // `computed`, then `if (alias())`), so this is the checker disagreeing with the framework, not with us.
  // Until that is fixed, the screen reads a non-null projection instead.
  const phase: Signal<Phase> = signal<Phase>('idle');
  const workspace: Signal<Workspace | null> = signal<Workspace | null>(null);
  const error: Signal<string> = signal('');
  const elapsed: Signal<number> = signal(0);
  const picked: Signal<string[]> = signal<string[]>([]);

  /**
   * Ask the service what is at `path`.
   *
   * The measured scan takes 20 ms on a small tree and close to 3 s on a cold large one, so the wait is real and
   * has to be visible — but it is nowhere near long enough to deserve a step of its own.
   */
  const scan = (): void => {
    const target: string = path().trim();
    if (!target) return;
    phase.set('scanning');
    error.set('');
    workspace.set(null);
    picked.set([]);
    const started: number = performance.now();

    void fetch(`/api/inspect?token=${encodeURIComponent(sessionToken())}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target }),
    })
      .then(async (res: Response): Promise<void> => {
        const body: unknown = await res.json();
        elapsed.set(Math.round(performance.now() - started));
        if (!res.ok) {
          // The service already names the path it tried; showing its words beats inventing our own.
          error.set(String((body as { error?: string }).error ?? `request failed (${res.status})`));
          phase.set('failed');
          return;
        }
        workspace.set(body as Workspace);
        phase.set('done');
      })
      .catch((e: unknown): void => {
        error.set(e instanceof Error ? e.message : String(e));
        phase.set('failed');
      });
  };

  const toggle = (unit: Unit): void => {
    picked.set((current: string[]): string[] =>
      current.includes(unit.root) ? current.filter((r: string): boolean => r !== unit.root) : [...current, unit.root],
    );
  };

  const isPicked = (unit: Unit): boolean => picked().includes(unit.root);

  /** A unit's path relative to the workspace root — the absolute one is noise once the root is on screen. */
  const relative = (unit: Unit): string => {
    const root: string = workspace()?.root ?? '';
    const rel: string = unit.root.startsWith(root) ? unit.root.slice(root.length) : unit.root;
    return rel.replace(/^[\\/]/, '').replace(/\\/g, '/') || '.';
  };

  /** `null` means no file declared a type. Say that, rather than filling the column with a guess. */
  const typeLabel = (unit: Unit): string => unit.type ?? 'unstated';

  /** The result, never null — `hasResult()` says whether it means anything yet. */
  const found: Computed<Workspace> = computed<Workspace>(() => workspace() ?? EMPTY);
  const hasResult: Computed<boolean> = computed<boolean>(() => workspace() !== null);

  return { path, phase, error, elapsed, picked, scan, toggle, isPicked, relative, typeLabel, found, hasResult };
}
