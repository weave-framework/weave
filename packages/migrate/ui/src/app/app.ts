import { computed, signal, type Computed, type Signal } from '@weave-framework/runtime';
import type { Entry, Listing, Unit, Workspace } from '../../../src/types.js';

/** What the screen is doing. `scanning` is the only state that makes the reader wait. */
export type Phase = 'idle' | 'scanning' | 'done' | 'failed';

/** Whether this page is talking to the service it belongs to. `unknown` only until the first answer. */
export type Session = 'unknown' | 'ok' | 'denied';

/**
 * The session token, when it is still in the URL.
 *
 * It arrives there once, on the link the service prints. The server then parks it in an HttpOnly cookie, this
 * page wipes it from the address bar, and every later request rides the cookie — so this returns empty on a
 * reload, and that is the normal case rather than a failure.
 */
function urlToken(): string {
  return new URLSearchParams(location.search).get('token') ?? '';
}

/** Build an API URL, carrying the token only while it is still in ours, plus any query the caller needs. */
function apiUrl(path: string, query: Record<string, string> = {}): string {
  const params: URLSearchParams = new URLSearchParams(query);
  const t: string = urlToken();
  if (t) params.set('token', t);
  const qs: string = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Drop the token from the address bar once the cookie holds it — a URL with a key in it gets pasted. */
function tidyAddressBar(): void {
  if (!urlToken()) return;
  const clean: string = location.pathname + location.hash;
  history.replaceState(null, '', clean);
}

/** Where recently used paths are kept. Per browser, per artifact origin — never sent anywhere. */
const RECENT_KEY: string = 'weave-migrate-recent';
const RECENT_MAX: number = 6;

/** Read the recent list, tolerating a storage that throws (private windows, blocked site data) or holds junk. */
function readRecent(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x: unknown): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Empty listing, so the template never handles null here either. */
const NO_LISTING: Listing = { path: '', parent: null, entries: [], shortcuts: [] };

/** Stand-in for "nothing scanned yet", so the template never handles null. */
const EMPTY: Workspace = { root: '', signals: [], units: [], scannedDepth: 0 };

export function setup(): {
  path: Signal<string>;
  phase: Signal<Phase>;
  session: Signal<Session>;
  browsing: Signal<boolean>;
  listing: Signal<Listing>;
  listingError: Signal<string>;
  recent: Signal<string[]>;
  openBrowser: () => void;
  closeBrowser: () => void;
  goTo: (target: string) => void;
  goUp: () => void;
  useFolder: (target: string) => void;
  markerLabel: (entry: Entry) => string;
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

    void fetch(apiUrl('/api/inspect'), {
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

  /**
   * Ask once, on load, whether this page is allowed to talk to the service. The cookie is HttpOnly, so script
   * cannot look for it — reaching the endpoint at all IS the answer. On success the address bar is tidied, which
   * is safe precisely because the cookie has by then been set by the very response that answered this.
   */
  const session: Signal<Session> = signal<Session>('unknown');
  void fetch(apiUrl('/api/session'))
    .then((res: Response): void => {
      session.set(res.ok ? 'ok' : 'denied');
      if (res.ok) tidyAddressBar();
    })
    .catch((): void => {
      session.set('denied');
    });

  /* ── the folder picker ──
     A browser will not hand a server a real path — `showDirectoryPicker()` returns a handle identified only by
     NAME, and `<input webkitdirectory>` gives paths relative to whatever was chosen. So the picker is ours,
     reading the filesystem through the service. It costs a panel and buys something a native dialog cannot
     give: the markers are visible while choosing, so you see where the Angular projects are before scanning. */
  const browsing: Signal<boolean> = signal(false);
  const listing: Signal<Listing> = signal<Listing>(NO_LISTING);
  const listingError: Signal<string> = signal('');
  const recent: Signal<string[]> = signal<string[]>(readRecent());

  const goTo = (target: string): void => {
    listingError.set('');
    void fetch(apiUrl('/api/browse', { path: target }))
      .then(async (res: Response): Promise<void> => {
        const body: unknown = await res.json();
        if (!res.ok) {
          listingError.set(String((body as { error?: string }).error ?? `could not read that folder (${res.status})`));
          return;
        }
        listing.set(body as Listing);
      })
      .catch((e: unknown): void => {
        listingError.set(e instanceof Error ? e.message : String(e));
      });
  };

  const openBrowser = (): void => {
    browsing.set(true);
    // Open where the typed path already points, so the picker continues the thought instead of restarting it.
    goTo(path().trim());
  };

  const closeBrowser = (): void => {
    browsing.set(false);
  };

  /** Up one level, or back to the roots when there is no parent — never a button that does nothing. */
  const goUp = (): void => {
    goTo(listing().parent ?? '');
  };

  /** Take this folder as the source, remember it, and scan straight away — the click already said "this one". */
  const useFolder = (target: string): void => {
    path.set(target);
    browsing.set(false);
    recent.set((current: string[]): string[] => {
      const next: string[] = [target, ...current.filter((p: string): boolean => p !== target)].slice(0, RECENT_MAX);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* a browser that refuses storage still gets a working picker — it just will not remember */
      }
      return next;
    });
    scan();
  };

  /** What a folder's markers say, in one short phrase — or nothing, which is also an answer. */
  const markerLabel = (entry: Entry): string => entry.markers.join(' · ');

  /** The result, never null — `hasResult()` says whether it means anything yet. */
  const found: Computed<Workspace> = computed<Workspace>(() => workspace() ?? EMPTY);
  const hasResult: Computed<boolean> = computed<boolean>(() => workspace() !== null);

  return {
    path,
    phase,
    error,
    elapsed,
    picked,
    scan,
    toggle,
    isPicked,
    relative,
    typeLabel,
    found,
    hasResult,
    session,
    browsing,
    listing,
    listingError,
    recent,
    openBrowser,
    closeBrowser,
    goTo,
    goUp,
    useFolder,
    markerLabel,
  };
}
