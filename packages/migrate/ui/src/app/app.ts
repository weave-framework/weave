import { computed, debounced, effect, onCleanup, signal, type Computed, type Signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';
import ButtonToggle from '@weave-framework/ui/button-toggle';
import Checkbox from '@weave-framework/ui/checkbox';
import Input from '@weave-framework/ui/input';
import type { Edge, Entry, Graph, GraphNode, Listing, Peek, Unit, Workspace } from '../../../src/types.js';
import {
  CARD_H,
  CARD_HEAD,
  CARD_W,
  dependencyClosure,
  fitScale,
  layout,
  layoutBeside,
  pathThrough,
  relatedEdges,
  type Layout,
  type PlacedNode,
} from './layout.js';
import { collapse as foldGroups, groupKeyFromId, groupKeyOf, isGroupId, type GroupSummary } from './group.js';

// Capitalized tags in the template resolve to these imports. The editor tooling understands that; eslint,
// running without it, sees three unused bindings — so the repo's convention is to name them here.
void Button;
void ButtonToggle;
void Checkbox;
void Input;

/** What the screen is doing. `scanning` is the only state that makes the reader wait. */
export type Phase = 'idle' | 'scanning' | 'done' | 'failed';

/** Whether this page is talking to the service it belongs to. `unknown` only until the first answer. */
export type Session = 'unknown' | 'ok' | 'denied' | 'stale';

/**
 * Routes this page calls. Checked against what the service says it serves, because `dist/` is shared: a service
 * started before the UI was rebuilt hands out the NEW page and then 404s the routes it asks for. Without this
 * the reader sees `no route GET /api/browse` and has no way to guess that a second, older server is the reason.
 */
const NEEDED_ROUTES: string[] = ['/api/inspect', '/api/browse', '/api/peek'];

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
  step: Signal<1 | 2>;
  analysing: Signal<boolean>;
  progress: Signal<{ done: number; total: number; reading: string } | null>;
  progressLine: Computed<string>;
  progressPercent: Computed<number>;
  pickedLabel: Computed<string>;
  graphError: Signal<string>;
  summary: Signal<Record<string, number | string> | null>;
  selected: Signal<string>;
  decisions: Signal<Record<string, 'migrate' | 'skip' | 'leave'>>;
  decisionFor: (nodeId: string) => string;
  decide: (nodeId: string, value: 'migrate' | 'skip' | 'leave') => void;
  migrateWithDependencies: (nodeId: string) => void;
  closureSize: (nodeId: string) => number;
  decisionCounts: Computed<{ migrate: number; skip: number; leave: number; total: number }>;
  clearDecisions: () => void;
  pick: (nodeId: string) => void;
  clearSelection: () => void;
  expanded: Signal<string>;
  expand: (nodeId: string) => void;
  expandFrom: (event: MouseEvent, nodeId: string) => void;
  collapse: () => void;
  hasExpanded: Computed<boolean>;
  onCanvasClick: (event: MouseEvent) => void;
  zoom: Signal<number>;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  zoomFit: () => void;
  zoomLabel: Computed<string>;
  canvasRef: (el: HTMLElement) => void;
  analyseSelection: () => void;
  placed: Computed<Layout | null>;
  highlighted: Computed<Set<string>>;
  isLit: (nodeId: string) => boolean;
  edgeLit: (from: string, to: string) => boolean;
  guardEdgeVisible: (from: string, to: string) => boolean;
  cardTag: (node: PlacedNode) => string;
  cardTitle: (node: PlacedNode) => string;
  cardComponent: (node: PlacedNode) => string;
  guardMark: (node: PlacedNode) => string;
  CARD_W: number;
  CARD_H: number;
  CARD_HEAD: number;
  view: Computed<Layout>;
  hasGraph: Computed<boolean>;
  groups: Computed<GroupSummary[]>;
  toggleGroup: (key: string) => void;
  isGroupOpen: (key: string) => boolean;
  jumpTo: (nodeId: string) => void;
  foldAll: () => void;
  openGroups: Signal<string[]>;
  revealed: Signal<string[]>;
  sel: Computed<PlacedNode>;
  hasSelection: Computed<boolean>;
  summaryLine: Computed<string>;
  lazyCount: Computed<number>;
  selectedNode: Computed<PlacedNode | null>;
  EXPANDED_W: number;
  EXPANDED_H: number;
  expandedX: Computed<number>;
  expandedY: Computed<number>;
  stopClick: (event: MouseEvent) => void;
  edgeDecided: (from: string, to: string) => boolean;
  isKept: (nodeId: string) => boolean;
  linkGroups: Computed<Array<{ title: string; items: Array<{ label: string; kind: string; external: boolean; id: string }> }>>;
  selectedLinks: Computed<Array<{ dir: 'uses' | 'used by'; kind: string; label: string; external: boolean }>>;
  externals: Computed<PlacedNode[]>;
  query: Signal<string>;
  setKind: (v: string | string[]) => void;
  kindOptions: Computed<Array<{ value: string; label: string; disabled?: boolean }>>;
  sourceOptions: Array<{ value: string; label: string; disabled?: boolean }>;
  source: Signal<string>;
  kind: Signal<'all' | 'application' | 'library' | 'unstated'>;
  shown: Computed<Unit[]>;
  counts: Computed<{ all: number; application: number; library: number; unstated: number }>;
  hint: Computed<'ask' | 'missing' | 'file' | 'markers' | 'bare'>;
  hintMarkers: Computed<string>;
  missingRoutes: Signal<string[]>;
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
  picked: Signal<string>;
  scan: () => void;
  choose: (unit: Unit) => void;
  isPicked: (unit: Unit) => boolean;
  relative: (unit: Unit) => string;
  typeLabel: (unit: Unit) => string;
} {
  /**
   * Which step is on screen. A wizard shows one step at a time — stacking them made the page grow without end
   * and squeezed the canvas into a column meant for prose.
   */
  const step: Signal<1 | 2> = signal<1 | 2>(1);

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
  /* One project, not a set. The multi-select was a promise the rest of the code never kept: analysis has
     always run on `picked()[0]` alone, so ticking a second box changed nothing except what the reader
     believed was about to happen. And one graph per project is the right shape anyway — two applications
     merged onto one canvas would put 400+ cards up with no way to tell whose library is whose. */
  const picked: Signal<string> = signal<string>('');

  /**
   * What is at the typed path, looked up as you stop typing.
   *
   * The field used to say nothing until Scan was pressed, so a pasted path gave no sign of being right until
   * after the wait — and a wrong one gave no sign at all. This makes the field answer the same way the picker
   * does: exists or not, and which markers it carries.
   *
   * 400 ms because that is roughly the pause after pasting; shorter fires mid-keystroke, longer feels broken.
   */
  const probe: Signal<Peek | null> = signal<Peek | null>(null);
  const typed: Computed<string> = debounced((): string => path().trim(), 400);
  effect((): void => {
    const target: string = typed();
    if (!target) {
      probe.set(null);
      return;
    }
    void fetch(apiUrl('/api/peek', { path: target }))
      .then(async (res: Response): Promise<void> => {
        if (!res.ok) {
          probe.set(null);
          return;
        }
        const body: Peek = (await res.json()) as Peek;
        // A slow answer for a path already replaced is not an answer about the current one.
        if (body.path && path().trim() && target === path().trim()) probe.set(body);
      })
      .catch((): void => {
        probe.set(null);
      });
  });

  /**
   * What the field should say right now, as one value.
   *
   * Decided here rather than in the template because `@if (expr; as alias)` binds only on the LEADING branch —
   * an `@else if` cannot see the alias at all — and the alias does not narrow under `weave check` anyway. A
   * template that has to work around both stops being readable; a named state does not.
   */
  const hint: Computed<'ask' | 'missing' | 'file' | 'markers' | 'bare'> = computed(() => {
    if (!path().trim()) return 'ask';
    const p: Peek | null = probe();
    if (!p) return 'ask';
    if (!p.exists) return 'missing';
    if (!p.directory) return 'file';
    return p.markers.length ? 'markers' : 'bare';
  });

  /** The markers of the folder currently in the field, ready to print. */
  const hintMarkers: Computed<string> = computed<string>(() => (probe()?.markers ?? []).join(' · '));

  /** Whether the folder picker is open. Declared here because `scan` closes it. */
  const browsing: Signal<boolean> = signal(false);

  /**
   * Ask the service what is at `path`.
   *
   * The measured scan takes 20 ms on a small tree and close to 3 s on a cold large one, so the wait is real and
   * has to be visible — but it is nowhere near long enough to deserve a step of its own.
   */
  const scan = (): void => {
    const target: string = path().trim();
    if (!target) return;
    // Scanning answers the question the picker was open to ask, so the picker closes. Leaving it open pushed
    // the result below it and read as "nothing happened" — the scan had run, the signals had updated, and none
    // of it was on screen.
    browsing.set(false);
    phase.set('scanning');
    error.set('');
    workspace.set(null);
    picked.set('');
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

  /** Choose this project, or clear it by choosing the one already chosen. */
  const choose = (unit: Unit): void => {
    picked.set(picked() === unit.root ? '' : unit.root);
  };

  const isPicked = (unit: Unit): boolean => picked() === unit.root;

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
  const missingRoutes: Signal<string[]> = signal<string[]>([]);
  void fetch(apiUrl('/api/session'))
    .then(async (res: Response): Promise<void> => {
      if (!res.ok) {
        session.set('denied');
        return;
      }
      tidyAddressBar();
      const body: { routes?: string[] } = (await res.json()) as { routes?: string[] };
      // An older service predates the field entirely, which is itself the answer: it cannot serve what this
      // page needs, so treat "no list" as "nothing matches" rather than assuming the best.
      const served: string[] = Array.isArray(body.routes) ? body.routes : [];
      const missing: string[] = NEEDED_ROUTES.filter((r: string): boolean => !served.includes(r));
      missingRoutes.set(missing);
      session.set(missing.length ? 'stale' : 'ok');
    })
    .catch((): void => {
      session.set('denied');
    });

  /* ── the folder picker ──
     A browser will not hand a server a real path — `showDirectoryPicker()` returns a handle identified only by
     NAME, and `<input webkitdirectory>` gives paths relative to whatever was chosen. So the picker is ours,
     reading the filesystem through the service. It costs a panel and buys something a native dialog cannot
     give: the markers are visible while choosing, so you see where the Angular projects are before scanning. */
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

  /* ── narrowing a long list ──
     A real workspace answers with 98 or 108 projects, and 105 of the 108 are libraries. Scrolling that to find
     three applications is not a task anyone should be given, and it is the one thing a terminal could never
     offer at all. */
  const query: Signal<string> = signal('');
  const kind: Signal<'all' | 'application' | 'library' | 'unstated'> = signal<'all' | 'application' | 'library' | 'unstated'>('all');

  /** The units currently on screen — the filters applied, nothing else. */
  const shown: Computed<Unit[]> = computed<Unit[]>(() => {
    const q: string = query().trim().toLowerCase();
    const k: 'all' | 'application' | 'library' | 'unstated' = kind();
    return found().units.filter((u: Unit): boolean => {
      if (k === 'unstated' ? u.type !== null : k !== 'all' && u.type !== k) return false;
      // Match the path as well as the name: in a monorepo the folder is often how you remember a project.
      return !q || u.name.toLowerCase().includes(q) || u.root.toLowerCase().includes(q);
    });
  });

  /** How many of each kind, so the filter buttons say what they will do before you press them. */
  const counts: Computed<{ all: number; application: number; library: number; unstated: number }> = computed(() => {
    const units: Unit[] = found().units;
    return {
      all: units.length,
      application: units.filter((u: Unit): boolean => u.type === 'application').length,
      library: units.filter((u: Unit): boolean => u.type === 'library').length,
      unstated: units.filter((u: Unit): boolean => u.type === null).length,
    };
  });

  /**
   * The type filter as a toggle group. Built here because the counts belong on the labels — a filter that says
   * "Libraries 105" tells you what pressing it will do; one that just says "Libraries" makes you press it to
   * find out.
   */
  const kindOptions: Computed<Array<{ value: string; label: string; disabled?: boolean }>> = computed(() => {
    const c: { all: number; application: number; library: number; unstated: number } = counts();
    const list: Array<{ value: string; label: string; disabled?: boolean }> = [
      { value: 'all', label: `All ${c.all}` },
      { value: 'application', label: `Applications ${c.application}`, disabled: c.application === 0 },
      { value: 'library', label: `Libraries ${c.library}`, disabled: c.library === 0 },
    ];
    // Only worth a segment when some project actually lacks a declared type.
    if (c.unstated) list.push({ value: 'unstated', label: `Unstated ${c.unstated}` });
    return list;
  });

  /**
   * Narrow the toggle's answer before it reaches the signal. `onChange` speaks `string | string[]` because the
   * component also serves multi-select; taking that on trust would put an arbitrary string into a typed union.
   */
  const setKind = (v: string | string[]): void => {
    const value: string = Array.isArray(v) ? (v[0] ?? 'all') : v;
    if (value === 'all' || value === 'application' || value === 'library' || value === 'unstated') kind.set(value);
  };

  /** Which source framework is selected. Only Angular is built, so the others are disabled segments. */
  const sourceOptions: Array<{ value: string; label: string; disabled?: boolean }> = [
    { value: 'angular', label: 'Angular' },
    { value: 'react', label: 'React', disabled: true },
    { value: 'vue', label: 'Vue', disabled: true },
  ];
  const source: Signal<string> = signal('angular');


  /* ── step two: the dependency graph ──
     Analysis is a full TypeScript walk — measured at 1-2 s on a real app, against 150 ms for the shallow scan
     of step one — so it runs only when asked, and says it is running. */
  const analysing: Signal<boolean> = signal(false);
  const graph: Signal<Graph | null> = signal<Graph | null>(null);
  const graphError: Signal<string> = signal('');
  const summary: Signal<Record<string, number | string> | null> = signal<Record<string, number | string> | null>(null);
  const selected: Signal<string> = signal('');

  /** The path last analysed, so re-opening can re-run against the same unit. */
  const analysedPath: Signal<string> = signal('');

  /** How far the read has got: `{done, total, reading}`, or null when nothing is running. */
  const progress: Signal<{ done: number; total: number; reading: string } | null> = signal<{
    done: number;
    total: number;
    reading: string;
  } | null>(null);

  const progressLine: Computed<string> = computed<string>(() => {
    const p: { done: number; total: number; reading: string } | null = progress();
    if (!p) return '';
    // No `+ 1` here. The service counts the unit it is about to read, so adding one produced
    // "Reading 13 of 12" on the last library of a round — reported from a screenshot.
    return `Reading ${p.done} of ${p.total} · ${p.reading}`;
  });

  const progressPercent: Computed<number> = computed<number>(() => {
    const p: { done: number; total: number; reading: string } | null = progress();
    // Capped below 100: a round can finish having discovered another round's worth of work, and a bar
    // that reaches the end and then keeps going is worse than one that never quite gets there.
    return p && p.total ? Math.min(96, Math.round((p.done / p.total) * 100)) : 0;
  });

  /**
   * Analyse a project, reading every workspace library it reaches.
   *
   * One wait instead of a session of them. Marking things to open, and the whole question of what to open, is
   * gone: the local code is read up front, npm packages are carried over untouched, and the graph is complete
   * before anyone is asked to decide anything. That was the point of the report — a decision should not be able
   * to surprise you with a hundred files you never saw.
   */
  const analyse = (target: string, keepView: boolean = false): void => {
    analysedPath.set(target);
    step.set(2);
    analysing.set(true);
    graphError.set('');
    // Widening keeps the drawing on screen: blanking it read as a crash and lost the reader's place. Only a
    // fresh analysis of a different project starts from nothing.
    if (!keepView) {
      graph.set(null);
      selected.set('');
      expanded.set('');
    }
    const host: HTMLElement | null = canvasEl();
    const keepScroll: { x: number; y: number } | null = keepView && host ? { x: host.scrollLeft, y: host.scrollTop } : null;
    progress.set(null);
    const source: EventSource = new EventSource(apiUrl('/api/analyze-stream', { path: target }));

    const finish = (): void => {
      source.close();
      analysing.set(false);
      progress.set(null);
    };

    source.addEventListener('progress', (event: MessageEvent): void => {
      progress.set(JSON.parse(event.data) as { done: number; total: number; reading: string });
    });

    source.addEventListener('failed', (event: MessageEvent): void => {
      graphError.set(String((JSON.parse(event.data) as { error?: string }).error ?? 'analysis failed'));
      finish();
    });

    source.addEventListener('done', (event: MessageEvent): void => {
      const payload: { graph: Graph; summary: Record<string, number | string> } = JSON.parse(event.data) as {
        graph: Graph;
        summary: Record<string, number | string>;
      };
      finish();
      graph.set(payload.graph);
      // The first sight of a graph should be the whole graph, not its top-left corner at 100%.
      fitSoon();
      summary.set(payload.summary);
        // Put the view back exactly where it was — a widened graph is the same drawing with more in it, and
        // being thrown back to the top left after every open is most of what made this unusable.
        if (keepScroll) {
          requestAnimationFrame((): void => {
            const el: HTMLElement | null = canvasEl();
            if (!el) return;
            el.scrollLeft = keepScroll.x;
            el.scrollTop = keepScroll.y;
          });
        }
    });

    // A stream that dies without a `done` is still a failure the reader has to see.
    source.addEventListener('error', (): void => {
      if (!analysing()) return;
      graphError.set('the connection to the migration service dropped mid-analysis');
      finish();
    });
  };

  /** Just the folder name of the pick — a full Windows path on a button reads as a bug. */
  const pickedLabel: Computed<string> = computed<string>(() => {
    const first: string = picked();
    // Split on both separators without a regex: an escaped backslash inside one has been mangled twice today
    // by the tooling writing this file, and a literal pair of characters cannot be.
    const parts: string[] = first.split('\\').join('/').split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
  });

  /** Analyse the chosen project. */
  const analyseSelection = (): void => {
    const chosen: string = picked();
    if (chosen) analyse(chosen);
  };

  /**
   * Which folder groups are open. Everything else is one card.
   *
   * The opening view is folded because 227 cards is not a drawing, and no arrangement of that many is. What a
   * person wants first is the shape — which of this is the application, which is the shared library — and that
   * is five cards, not two hundred.
   */
  const openGroups: Signal<string[]> = signal<string[]>([]);

  /**
   * Cards lifted out of their folders and kept on the canvas.
   *
   * This ACCUMULATES, and that is the whole point. Deriving it from the current selection alone answered one
   * question and then forgot it: selecting the next card put the previous one back in its folder, so a chain
   * could never be walked. The only way to go deeper was to open a folder, which for `components` means 72
   * cards that connect to everything — the reader's "viskas susimakaluoja".
   *
   * Following a trail adds to what is on screen. `Clear selection` puts it all back.
   */
  const revealed: Signal<string[]> = signal<string[]>([]);

  /** Lift a card and its immediate neighbours onto the canvas, keeping whatever was already lifted. */
  const reveal = (nodeId: string): void => {
    const g: Graph | null = graph();
    if (!g || !nodeId || isGroupId(nodeId)) return;
    const add: string[] = [nodeId];
    for (const e of g.edges) {
      if (e.from === nodeId) add.push(e.to);
      if (e.to === nodeId) add.push(e.from);
    }
    revealed.set((current: string[]): string[] => [...new Set([...current, ...add])]);
  };


  /** The graph as it is currently folded, and what each group card stands for. */
  const folded: Computed<{ graph: Graph; groups: GroupSummary[]; worthGrouping: boolean } | null> = computed(() => {
    const g: Graph | null = graph();
    return g ? foldGroups(g, new Set(openGroups()), new Set(revealed())) : null;
  });

  /**
   * Positions come from the graph WITHOUT the selection's revealed neighbours.
   *
   * `layout` is deterministic, so adding one card re-flows every other one: selecting a card moved 17 of 36,
   * and the card under the pointer became a different card. Every complaint about the selection — "nieko
   * nenutiko", a card that "pats pasikeite is pilko i zalia", needing three clicks — is that one fact. So the
   * arrangement is decided before the selection is taken into account, and stays put while one is made.
   */
  const baseLayout: Computed<Layout | null> = computed<Layout | null>(() => {
    const g: Graph | null = graph();
    return g ? layout(foldGroups(g, new Set(openGroups())).graph) : null;
  });

  /** The laid-out graph: the stable arrangement, plus wherever the revealed neighbours had to go. */
  const placed: Computed<Layout | null> = computed<Layout | null>(() => {
    const base: Layout | null = baseLayout();
    const f: { graph: Graph } | null = folded();
    if (!base || !f) return base;
    return f.graph.nodes.length === base.nodes.length ? base : layoutBeside(f.graph, base, revealed());
  });


  /** Every group, open or not — the list beside the canvas, and the migration checklist later. */
  const groups: Computed<GroupSummary[]> = computed<GroupSummary[]>(() => folded()?.groups ?? []);

  /** Open a folded group, or fold an open one back. */
  const toggleGroup = (key: string): void => {
    openGroups.set((current: string[]): string[] =>
      current.includes(key) ? current.filter((k: string): boolean => k !== key) : [...current, key],
    );
    // A card that is no longer on the canvas cannot stay selected or open.
    selected.set('');
    expanded.set('');
  };

  const isGroupOpen = (key: string): boolean => openGroups().includes(key);

  /**
   * Select a node by id, opening whatever folder it is folded inside.
   *
   * The links panel names the REAL neighbour — `AdministrationUsersComponent`, not the folder it was folded
   * into — which is the useful answer and also a card that may not be on the canvas. Setting the selection
   * to a folded id selected nothing, and the panel that had just offered the link vanished: a dead end at
   * the exact moment the reader followed the trail. Opening the folder first makes the link mean what it
   * looks like it means.
   */
  const jumpTo = (nodeId: string): void => {
    const g: Graph | null = graph();
    const node: GraphNode | undefined = g?.nodes.find((n: GraphNode): boolean => n.id === nodeId);
    const key: string | null = node ? groupKeyOf(node) : null;
    if (key !== null && !openGroups().includes(key)) {
      openGroups.set((current: string[]): string[] => [...current, key]);
    }
    selected.set(nodeId);
    reveal(nodeId);
  };

  /** Fold everything back — the way home from any depth. */
  const foldAll = (): void => {
    revealed.set([]);
    openGroups.set([]);
    selected.set('');
    expanded.set('');
    fitSoon();
  };

  /** The node currently selected, if any. */
  const selectedNode: Computed<PlacedNode | null> = computed<PlacedNode | null>(() => {
    const l: Layout | null = placed();
    const id: string = selected();
    return l && id ? (l.nodes.find((n: PlacedNode): boolean => n.id === id) ?? null) : null;
  });

  /**
   * What the selected node depends on, and what depends on it — the 227 injection edges, revealed one node at a
   * time instead of drawn all at once.
   */
  const selectedLinks: Computed<Array<{ dir: 'uses' | 'used by'; kind: string; label: string; external: boolean }>> = computed(() => {
    const g: Graph | null = graph();
    const id: string = selected();
    if (!g || !id) return [];
    const label = (nodeId: string): { label: string; external: boolean } => {
      const n: GraphNode | undefined = g.nodes.find((x: GraphNode): boolean => x.id === nodeId);
      return { label: n?.label ?? nodeId, external: n?.kind === 'external' };
    };
    return relatedEdges(g, id).map((e: Edge) => {
      const other: { label: string; external: boolean } = e.from === id ? label(e.to) : label(e.from);
      return { dir: e.from === id ? ('uses' as const) : ('used by' as const), kind: e.kind, label: other.label, external: other.external };
    });
  });

  /**
   * The selected node's connections, grouped by what the relationship IS.
   *
   * A flat list of thirteen lines reading "uses injects X" makes a reader do the grouping in their head. The
   * question a person actually has is "what does this thing need, and who needs it" — two questions, so two
   * groups, each with its own count.
   */
  const linkGroups: Computed<Array<{ title: string; items: Array<{ label: string; kind: string; external: boolean; id: string }> }>> =
    computed(() => {
      const g: Graph | null = graph();
      const nodeId: string = selected();
      if (!g || !nodeId) return [];

      const uses: Array<{ label: string; kind: string; external: boolean; id: string }> = [];
      const usedBy: Array<{ label: string; kind: string; external: boolean; id: string }> = [];
      for (const e of g.edges) {
        if (e.from !== nodeId && e.to !== nodeId) continue;
        const otherId: string = e.from === nodeId ? e.to : e.from;
        const other: GraphNode | undefined = g.nodes.find((n: GraphNode): boolean => n.id === otherId);
        if (!other) continue;
        const item: { label: string; kind: string; external: boolean; id: string } = {
          label: other.label,
          kind: e.kind,
          external: other.kind === 'external',
          id: other.id,
        };
        (e.from === nodeId ? uses : usedBy).push(item);
      }
      const groups: Array<{ title: string; items: Array<{ label: string; kind: string; external: boolean; id: string }> }> = [];
      if (uses.length) groups.push({ title: `Needs ${uses.length}`, items: uses });
      if (usedBy.length) groups.push({ title: `Needed by ${usedBy.length}`, items: usedBy });
      return groups;
    });

  /** The heaviest external nodes — the decisions this step exists to collect, ordered by how much rides on them. */
  const externals: Computed<PlacedNode[]> = computed<PlacedNode[]>(() => {
    const l: Layout | null = placed();
    const g: Graph | null = graph();
    if (!g) return [];
    const known: Set<string> = new Set((l?.nodes ?? []).map((n: PlacedNode): string => n.id));
    void known;
    return g.nodes
      .filter((n): boolean => n.kind === 'external')
      .sort((a, b) => b.weight - a.weight)
      .map((n): PlacedNode => ({ ...n, x: 0, y: 0, r: 0, level: 0 }));
  });

  /**
   * Select a card, or clear it by clicking the one already selected.
   *
   * Reported: once something was picked there was no way back to the whole picture — every click only moved the
   * selection, never removed it. A click on the same card now clears; so does Escape, and so does the canvas
   * background.
   */
  const pick = (nodeId: string): void => {
    // A group card stands for its contents, so the useful thing a click can do is show them. Selecting it
    // would light a path made of edges that are summaries, which is a picture of nothing in particular.
    if (isGroupId(nodeId)) {
      toggleGroup(groupKeyFromId(nodeId));
      return;
    }
    const next: string = selected() === nodeId ? '' : nodeId;
    selected.set(next);
    // Following the trail adds to the canvas rather than replacing what is on it.
    if (next) reveal(next);
    // Selecting a different card while one is open moves the open card too; selecting nothing closes it.
    if (expanded() && expanded() !== nodeId) expanded.set('');
  };

  /**
   * Which card is opened, kept apart from which card is SELECTED.
   *
   * Reported: a single click began opening the panel immediately, and there was no longer a way to just look at
   * what a card connects to. One click selects and lights the path; opening is a second, deliberate act —
   * double-click, or the ⋯ on the card.
   */
  const expanded: Signal<string> = signal('');

  const expand = (nodeId: string): void => {
    selected.set(nodeId);
    expanded.set(nodeId);
  };

  const collapse = (): void => {
    expanded.set('');
  };

  /**
   * Open from the ⋯ without the click also reaching the card underneath.
   *
   * It does reach it otherwise, and `pick` toggles: clicking ⋯ on an already-selected card deselected it, which
   * closed the very panel the ⋯ had just opened. Stopping the event here is the only place that ordering can be
   * controlled, since the card's own handler runs afterwards either way.
   */
  const expandFrom = (event: MouseEvent, nodeId: string): void => {
    event.stopPropagation();
    expand(nodeId);
  };

  const clearSelection = (): void => {
    revealed.set([]);
    selected.set('');
    expanded.set('');
  };

  /**
   * A click on empty canvas clears; a click that landed on a card does not.
   *
   * Decided by asking the event where it landed rather than by stopping propagation on the card: `|stop` on an
   * SVG `<g>` did not keep this handler from firing, and the selection was cleared in the same tick it was
   * made — the card looked unclickable. Reading `target` cannot be undone by anything upstream.
   */
  const onCanvasClick = (event: MouseEvent): void => {
    const target: Element | null = event.target as Element | null;
    if (target?.closest('.card')) return;
    clearSelection();
  };

  /* ── zoom ──
     A real app draws 2000x4000 of canvas. Scrolling that at 1:1 to find one card is not looking at a graph, it
     is looking through a keyhole. The viewBox stays fixed and the rendered size scales, so scrolling keeps
     working normally at every level and nothing is re-laid-out. */
  const zoom: Signal<number> = signal(1);
  const ZOOM_MIN: number = 0.25;
  const ZOOM_MAX: number = 2;

  const zoomBy = (factor: number): void => {
    zoom.set((z: number): number => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * factor * 100) / 100)));
  };
  const zoomIn = (): void => zoomBy(1.25);
  const zoomOut = (): void => zoomBy(0.8);
  const zoomReset = (): void => {
    zoom.set(1);
  };

  /** Scale that fits the whole drawing across the canvas element, so "everything at once" is one click. */
  /**
   * Scale so the WHOLE graph is in view — both directions.
   *
   * It fitted the width only, which on a graph 1512 wide and 1704 tall inside a 1122x495 box set 73% and
   * left the reader looking at a quarter of it, with the button reporting success. Fitting means fitting.
   */
  const zoomFit = (): void => {
    const host: HTMLElement | null = canvasEl();
    const view: Layout | null = placed();
    if (!host || !view) return;
    zoom.set(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, 
      Math.round(fitScale(view.width, view.height, host.clientWidth, host.clientHeight) * 100) / 100)));
  };

  /**
   * Fit once the new layout is on screen.
   *
   * A graph nobody has seen yet opens at 100%, which for a real application is a quarter of it in a window
   * that has to be scrolled in both directions to find out what is there. The button existed; nobody looks
   * for a button before they have seen the thing it acts on. Deferred a frame because the layout this
   * measures is computed from the signal that is being set right now.
   */
  const fitSoon = (): void => {
    requestAnimationFrame((): void => {
      requestAnimationFrame(zoomFit);
    });
  };

  const zoomLabel: Computed<string> = computed<string>(() => `${Math.round(zoom() * 100)}%`);

  /**
   * The scrolling box around the canvas — needed to keep a point still while the scale changes.
   *
   * A signal, not a plain variable: the effect below runs when `setup` does, long before the canvas exists (it
   * only appears after an analysis). A plain variable was still null at that moment, the effect returned, and
   * nothing ever re-ran it — the wheel listener was never attached at all.
   */
  const canvasEl: Signal<HTMLElement | null> = signal<HTMLElement | null>(null);
  const canvasRef = (el: HTMLElement): void => {
    canvasEl.set(el);
  };

  /**
   * Ctrl/⌘ + wheel zooms the graph instead of the browser.
   *
   * `preventDefault` needs a non-passive listener, which a `on:wheel` binding cannot promise — so it is attached
   * by hand. Without it the browser's own page zoom wins and the canvas never sees the gesture.
   *
   * The point under the cursor stays under the cursor: scale alone would slide the drawing out from under the
   * hand, which is exactly the moment a zoom stops feeling like zoom.
   */
  effect((): void => {
    const host: HTMLElement | null = canvasEl();
    if (!host) return;

    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return; // a plain wheel is still a scroll
      event.preventDefault();

      const before: number = zoom();
      const factor: number = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const after: number = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(before * factor * 100) / 100));
      if (after === before) return;

      const box: DOMRect = host.getBoundingClientRect();
      const pointerX: number = event.clientX - box.left;
      const pointerY: number = event.clientY - box.top;
      // Where the cursor is in the drawing's own coordinates, which do not change with scale.
      const contentX: number = (host.scrollLeft + pointerX) / before;
      const contentY: number = (host.scrollTop + pointerY) / before;

      zoom.set(after);
      // After the new size renders, put the same content point back under the cursor.
      requestAnimationFrame((): void => {
        host.scrollLeft = contentX * after - pointerX;
        host.scrollTop = contentY * after - pointerY;
      });
    };

    host.addEventListener('wheel', onWheel, { passive: false });
    onCleanup((): void => host.removeEventListener('wheel', onWheel));
  });

  // Escape clears the selection wherever focus happens to be — the canvas is not focusable, so a key handler
  // on it would never fire.
  effect((): void => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      // Escape closes the card first, and only clears the selection when nothing is open — one step at a time.
      if (expanded()) collapse();
      else clearSelection();
    };
    document.addEventListener('keydown', onKey);
    onCleanup((): void => document.removeEventListener('keydown', onKey));
  });

  /* ── decisions ──
     The graph could be looked at and nothing more. A card is where a person says what happens to the thing it
     stands for, and what that means depends on whether the walk ever read it:

       read already (routes, modules, components)  →  migrate it, or leave it out
       never read (an external class or library)    →  open it (read and migrate it), or leave it behind

     Kept in one map keyed by node id, because that is what has to become the file the converter reads: a
     decision is only useful if it survives the session that made it. */
  const decisions: Signal<Record<string, 'migrate' | 'skip' | 'leave'>> = signal<
    Record<string, 'migrate' | 'skip' | 'leave'>
  >({});

  const decisionFor = (nodeId: string): string => decisions()[nodeId] ?? '';

  /**
   * Open a library for real: record the decision, then widen the walk and redraw.
   *
   * Marking `open` used to change a colour and nothing else — the analysis never re-ran, so the graph could
   * never grow past its first level, and a service marked "open and migrate" still showed zero dependencies.
   * Opening one is what makes the next level exist.
   */
  const decide = (nodeId: string, value: 'migrate' | 'skip' | 'leave'): void => {
    decisions.set((current: Record<string, 'migrate' | 'skip' | 'leave'>) => {
      const next: Record<string, 'migrate' | 'skip' | 'leave'> = { ...current };
      // Choosing the same answer again clears it — the same way clicking a selected card deselects it.
      if (next[nodeId] === value) delete next[nodeId];
      else next[nodeId] = value;
      return next;
    });
  };

  /**
   * "Migrate this and everything it needs."
   *
   * Marks the forward closure — what this node renders, injects, loads and is guarded by — and marks unread
   * dependencies as `open`, since they cannot be migrated without being read first. That distinction is the
   * whole reason the two verbs exist.
   */
  const migrateWithDependencies = (nodeId: string): void => {
    const g: Graph | null = graph();
    if (!g) return;
    const closure: Set<string> = dependencyClosure(g, nodeId);
    decisions.set((current: Record<string, 'migrate' | 'skip' | 'leave'>) => {
      const next: Record<string, 'migrate' | 'skip' | 'leave'> = { ...current };
      for (const nid of closure) {
        const node: GraphNode | undefined = g.nodes.find((n: GraphNode): boolean => n.id === nid);
        if (!node) continue;
        // An external is an npm package now — carried over as a dependency, never migrated — so the
        // closure marks only what is ours to move.
        if (node.kind === 'external') continue;
        next[nid] = 'migrate';
      }
      return next;
    });
  };

  /** How many things this node would pull in — shown on the button, so the click is not a surprise. */
  const closureSize = (nodeId: string): number => {
    const g: Graph | null = graph();
    return g && nodeId ? dependencyClosure(g, nodeId).size : 0;
  };

  /** A running tally, so the page always says what has been decided so far. */
  const decisionCounts: Computed<{ migrate: number; skip: number; leave: number; total: number }> = computed(() => {
    const all: Array<'migrate' | 'skip' | 'leave'> = Object.values(decisions());
    return {
      migrate: all.filter((d): boolean => d === 'migrate').length,
      skip: all.filter((d): boolean => d === 'skip').length,
      leave: all.filter((d): boolean => d === 'leave').length,
      total: all.length,
    };
  });

  const clearDecisions = (): void => {
    decisions.set({});
  };

  /**
   * Everything on the selected node's path — lit up, while the rest of the canvas dims.
   *
   * Computed on the FOLDED graph, because that is what is drawn. Against the raw graph it answers with node
   * ids that are not on the canvas — a component that has been folded into its folder — so every edge on
   * screen failed the "both ends lit" test and the whole picture dimmed at once. Reported as selecting a route
   * and seeing no dependencies at all: the path was found, in a graph nobody was looking at.
   */
  const highlighted: Computed<Set<string>> = computed<Set<string>>(() => {
    const g: Graph | undefined = folded()?.graph;
    const id: string = selected();
    return g && id ? pathThrough(g, id) : new Set<string>();
  });

  /** Is this node on the lit path? With nothing selected everything is lit, so the canvas reads normally. */
  const isLit = (nodeId: string): boolean => {
    const set: Set<string> = highlighted();
    return set.size === 0 || set.has(nodeId);
  };

  /** Is this edge on the lit path? Both ends must be, or a line would glow into the dark. */
  const edgeLit = (from: string, to: string): boolean => {
    const set: Set<string> = highlighted();
    return set.size === 0 || (set.has(from) && set.has(to));
  };

  /**
   * A guard edge is drawn only while something is selected.
   *
   * With 107 of them into three nodes, drawing them by default put a mesh over the entire tree. The card's own
   * mark says a route is guarded; the lines are for the moment you ask which.
   */
  const guardEdgeVisible = (from: string, to: string): boolean => {
    const set: Set<string> = highlighted();
    return set.size > 0 && set.has(from) && set.has(to);
  };

  /**
   * A card's title, trimmed to what actually fits.
   *
   * SVG text has no overflow handling — it simply runs on, straight across the next card. At 11.5px in a
   * monospace face roughly 21 characters fit inside a 168px card, and `administration.application-settings` is
   * thirty-four. The full name stays reachable in the tooltip and the inspector.
   */
  const cardTitle = (node: PlacedNode): string => (node.label.length > 21 ? `${node.label.slice(0, 20)}…` : node.label);

  /** The component a route opens, trimmed to the card — the answer to "what does (default) actually show". */
  const cardComponent = (node: PlacedNode): string => {
    const name: string = node.component ?? '';
    return name.length > 22 ? `${name.slice(0, 21)}…` : name;
  };

  /**
   * Guards, as a mark on the card rather than a line to somewhere.
   *
   * Nearly every route has them: 107 edges into three nodes, which drew a mesh over the whole tree and hid the
   * thing the tree was for. The count says they exist; the lines appear only when something is selected.
   */
  const guardMark = (node: PlacedNode): string => {
    const count: number = node.guards?.length ?? 0;
    return count ? `⛨${count}` : '';
  };

  /* ── the expanded card ──
     Reported: the panel below the canvas meant scrolling away from the thing being looked at, to a list whose
     purpose was not obvious. Everything about a card belongs ON the card. Selecting one opens it in place,
     over the drawing, with its connections and its decision inside it. */
  const EXPANDED_W: number = 340;
  const EXPANDED_H: number = 300;

  /** Keep the opened card inside the drawing, so it never hangs off the right or bottom edge. */
  const expandedX: Computed<number> = computed<number>(() => {
    const node: PlacedNode = sel();
    return Math.max(8, Math.min(node.x - 8, Math.max(0, view().width - EXPANDED_W - 8)));
  });
  const expandedY: Computed<number> = computed<number>(() => {
    const node: PlacedNode = sel();
    return Math.max(8, Math.min(node.y - 8, Math.max(0, view().height - EXPANDED_H - 8)));
  });

  /** Keep a click inside the opened card from reaching the canvas, which would close it immediately. */
  const stopClick = (event: MouseEvent): void => {
    event.stopPropagation();
  };

  /** An edge between two things both marked for migration — the path someone has already committed to. */
  const edgeDecided = (from: string, to: string): boolean => {
    const map: Record<string, string> = decisions();
    const a: string | undefined = map[from];
    const b: string | undefined = map[to];
    const kept = (v: string | undefined): boolean => v === 'migrate';
    return kept(a) && kept(b);
  };

  /** Is this node marked to be carried over, either way of being carried over? */
  const isKept = (nodeId: string): boolean => {
    const d: string = decisionFor(nodeId);
    return d === 'migrate';
  };

  /** What a card's header says: the kind, and the count that matters for it. */
  const cardTag = (node: PlacedNode): string => {
    // "Nothing points here" is worth its own word: a way into the app, or something orphaned. Either way the
    // reader should not have to wonder whether the card is a bug.
    if (node.root) return node.kind === 'module' ? 'ROOT MODULE' : 'ROOT ROUTE';
    // A route that carries its component IS the screen — one thing, and the word a person would use for it.
    if (node.kind === 'route' && node.component && !node.folded) return node.lazy ? 'LAZY SCREEN' : 'SCREEN';
    if (node.kind === 'group') return `${node.weight} INSIDE`;
    if (node.kind === 'ngmodule') return 'NGMODULE';
    if (node.kind === 'module') return 'MODULE';
    // Two very different things used to share one word. A class from npm is never migrated and never read —
    // that is the plan, not a shortfall. A class backed by a workspace file that stayed shut IS a shortfall,
    // and calling both "not read" made the normal case look broken and hid the real one among 26 of them.
    if (node.kind === 'external') return node.libraryPath ? 'UNREAD' : 'NPM';
    if (node.kind === 'component') return 'COMPONENT';
    if (node.kind === 'service') return 'SERVICE';
    // A folded card is the route AND the module it opens; saying only "route" would hide half of what it is.
    if (node.folded) return 'LAZY MODULE';
    return node.lazy ? 'LAZY ROUTE' : 'ROUTE';
  };

  /* Non-null projections, for the same reason as `found`: `@if (x; as y)` does not narrow under `weave check`,
     and its alias binds only on the leading branch. Named states read better than working around both. */
  const EMPTY_LAYOUT: Layout = { nodes: [], edges: [], width: 0, height: 0 };
  const view: Computed<Layout> = computed<Layout>(() => placed() ?? EMPTY_LAYOUT);
  const hasGraph: Computed<boolean> = computed<boolean>(() => placed() !== null);
  const sel: Computed<PlacedNode> = computed<PlacedNode>(
    () => selectedNode() ?? { id: '', kind: 'module', label: '', detail: '', weight: 0, x: 0, y: 0, r: 0, level: 0 },
  );
  const hasSelection: Computed<boolean> = computed<boolean>(() => selectedNode() !== null);
  /** Is a card open? Separate from selection, which only lights a path. */
  const hasExpanded: Computed<boolean> = computed<boolean>(() => expanded() !== '' && selectedNode() !== null);
  const summaryLine: Computed<string> = computed<string>(() => {
    const sm: Record<string, number | string> | null = summary();
    return sm ? `${sm.files} files · ${sm.components} components · ${sm.routes} routes` : '';
  });
  const lazyCount: Computed<number> = computed<number>(() => Number(summary()?.lazy ?? 0));

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
    choose,
    isPicked,
    relative,
    typeLabel,
    found,
    hasResult,
    session,
    missingRoutes,
    step,
    analysing,
    progress,
    progressLine,
    progressPercent,
    pickedLabel,
    graphError,
    summary,
    selected,
    decisions,
    decisionFor,
    decide,
    migrateWithDependencies,
    closureSize,
    decisionCounts,
    clearDecisions,
    pick,
    clearSelection,
    expanded,
    expand,
    expandFrom,
    collapse,
    hasExpanded,
    onCanvasClick,
    zoom,
    zoomIn,
    zoomOut,
    zoomReset,
    zoomFit,
    zoomLabel,
    canvasRef,
    analyseSelection,
    placed,
    highlighted,
    isLit,
    edgeLit,
    guardEdgeVisible,
    cardTag,
    cardTitle,
    cardComponent,
    guardMark,
    CARD_W,
    CARD_H,
    CARD_HEAD,
    view,
    hasGraph,
    groups,
    toggleGroup,
    isGroupOpen,
    jumpTo,
    foldAll,
    openGroups,
    revealed,
    sel,
    hasSelection,
    summaryLine,
    lazyCount,
    selectedNode,
    selectedLinks,
    linkGroups,
    EXPANDED_W,
    EXPANDED_H,
    expandedX,
    expandedY,
    stopClick,
    edgeDecided,
    isKept,
    externals,
    query,
    setKind,
    kindOptions,
    sourceOptions,
    source,
    kind,
    shown,
    counts,
    hint,
    hintMarkers,
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
