import { computed, debounced, effect, signal, type Computed, type Signal } from '@weave-framework/runtime';
import Button from '@weave-framework/ui/button';
import ButtonToggle from '@weave-framework/ui/button-toggle';
import Checkbox from '@weave-framework/ui/checkbox';
import Input from '@weave-framework/ui/input';
import type { Edge, Entry, Graph, GraphNode, Listing, Peek, Unit, Workspace } from '../../../src/types.js';
import { CARD_H, CARD_HEAD, CARD_W, layout, pathThrough, relatedEdges, type Layout, type PlacedNode } from './layout.js';

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
  pickedLabel: Computed<string>;
  graphError: Signal<string>;
  summary: Signal<Record<string, number | string> | null>;
  selected: Signal<string>;
  analyseSelection: () => void;
  placed: Computed<Layout | null>;
  highlighted: Computed<Set<string>>;
  isLit: (nodeId: string) => boolean;
  edgeLit: (from: string, to: string) => boolean;
  cardTag: (node: PlacedNode) => string;
  cardTitle: (node: PlacedNode) => string;
  CARD_W: number;
  CARD_H: number;
  CARD_HEAD: number;
  view: Computed<Layout>;
  hasGraph: Computed<boolean>;
  sel: Computed<PlacedNode>;
  hasSelection: Computed<boolean>;
  summaryLine: Computed<string>;
  lazyCount: Computed<number>;
  selectedNode: Computed<PlacedNode | null>;
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
  pickShown: () => void;
  clearPicked: () => void;
  allShownPicked: Computed<boolean>;
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
  picked: Signal<string[]>;
  scan: () => void;
  toggle: (unit: Unit) => void;
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
  const picked: Signal<string[]> = signal<string[]>([]);

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

  /** Pick every unit currently shown — the filter is the selection tool, so this respects it. */
  const pickShown = (): void => {
    const roots: string[] = shown().map((u: Unit): string => u.root);
    picked.set((current: string[]): string[] => [...new Set([...current, ...roots])]);
  };

  /** Clear the whole selection, including anything a filter is currently hiding — otherwise "clear" lies. */
  const clearPicked = (): void => {
    picked.set([]);
  };

  const allShownPicked: Computed<boolean> = computed<boolean>(() => {
    const list: Unit[] = shown();
    return list.length > 0 && list.every((u: Unit): boolean => picked().includes(u.root));
  });

  /* ── step two: the dependency graph ──
     Analysis is a full TypeScript walk — measured at 1-2 s on a real app, against 150 ms for the shallow scan
     of step one — so it runs only when asked, and says it is running. */
  const analysing: Signal<boolean> = signal(false);
  const graph: Signal<Graph | null> = signal<Graph | null>(null);
  const graphError: Signal<string> = signal('');
  const summary: Signal<Record<string, number | string> | null> = signal<Record<string, number | string> | null>(null);
  const selected: Signal<string> = signal('');

  const analyse = (target: string): void => {
    step.set(2);
    analysing.set(true);
    graphError.set('');
    graph.set(null);
    selected.set('');
    void fetch(apiUrl('/api/analyze'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: target }),
    })
      .then(async (res: Response): Promise<void> => {
        const body: unknown = await res.json();
        analysing.set(false);
        if (!res.ok) {
          graphError.set(String((body as { error?: string }).error ?? `analysis failed (${res.status})`));
          return;
        }
        const payload: { graph: Graph; summary: Record<string, number | string> } = body as {
          graph: Graph;
          summary: Record<string, number | string>;
        };
        graph.set(payload.graph);
        summary.set(payload.summary);
      })
      .catch((e: unknown): void => {
        analysing.set(false);
        graphError.set(e instanceof Error ? e.message : String(e));
      });
  };

  /** Just the folder name of the first pick — a full Windows path on a button reads as a bug. */
  const pickedLabel: Computed<string> = computed<string>(() => {
    const first: string = picked()[0] ?? '';
    // Split on both separators without a regex: an escaped backslash inside one has been mangled twice today
    // by the tooling writing this file, and a literal pair of characters cannot be.
    const parts: string[] = first.split('\\').join('/').split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
  });

  /** Analyse the first project that was picked — the graph answers about one unit at a time. */
  const analyseSelection = (): void => {
    const first: string | undefined = picked()[0];
    if (first) analyse(first);
  };

  /** The laid-out graph, recomputed only when the graph itself changes. */
  const placed: Computed<Layout | null> = computed<Layout | null>(() => {
    const g: Graph | null = graph();
    return g ? layout(g) : null;
  });

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

  /** Everything on the selected node's path — lit up, while the rest of the canvas dims. */
  const highlighted: Computed<Set<string>> = computed<Set<string>>(() => {
    const g: Graph | null = graph();
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
   * A card's title, trimmed to what actually fits.
   *
   * SVG text has no overflow handling — it simply runs on, straight across the next card. At 11.5px in a
   * monospace face roughly 21 characters fit inside a 168px card, and `administration.application-settings` is
   * thirty-four. The full name stays reachable in the tooltip and the inspector.
   */
  const cardTitle = (node: PlacedNode): string => (node.label.length > 21 ? `${node.label.slice(0, 20)}…` : node.label);

  /** What a card's header says: the kind, and the count that matters for it. */
  const cardTag = (node: PlacedNode): string => {
    if (node.kind === 'module') return 'MODULE';
    if (node.kind === 'external') return 'NOT READ';
    if (node.kind === 'component') return 'COMPONENT';
    if (node.kind === 'service') return 'SERVICE';
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
    toggle,
    isPicked,
    relative,
    typeLabel,
    found,
    hasResult,
    session,
    missingRoutes,
    step,
    analysing,
    pickedLabel,
    graphError,
    summary,
    selected,
    analyseSelection,
    placed,
    highlighted,
    isLit,
    edgeLit,
    cardTag,
    cardTitle,
    CARD_W,
    CARD_H,
    CARD_HEAD,
    view,
    hasGraph,
    sel,
    hasSelection,
    summaryLine,
    lazyCount,
    selectedNode,
    selectedLinks,
    externals,
    query,
    setKind,
    kindOptions,
    sourceOptions,
    source,
    kind,
    shown,
    counts,
    pickShown,
    clearPicked,
    allShownPicked,
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
