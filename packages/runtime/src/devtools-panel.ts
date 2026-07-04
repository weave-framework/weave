/**
 * @weave-framework/runtime — the in-app DevTools **panel** (the visual layer over the
 * introspection registry in `./devtools.ts`). A zero-dependency, self-contained floating
 * overlay: it lists every registered **named** reactive node (`signal`/`computed`/`effect`)
 * with its live value, filterable by name, and updates surgically.
 *
 * Liveness is signal-native, no polling: a single `effect` calls {@link inspect} (which reads
 * each node's getter) so it re-runs whenever ANY tracked value changes; a `version` signal
 * bridged from {@link onDevtoolsChange} makes it also re-run when nodes register/unregister.
 *
 * Dev-only + tree-shakeable: nothing here runs unless an app explicitly calls
 * {@link mountDevtoolsPanel} (typically behind a dev flag). Needs {@link enableDevtools} on
 * BEFORE the app's named nodes are created (registration is skipped while off).
 */
import { signal, effect } from './reactive.js';
import type { Signal } from './reactive.js';
import {
  inspect,
  inspectGraph,
  inspectTrace,
  inspectTree,
  onDevtoolsChange,
  isDevtoolsEnabled,
  type DevSnapshot,
  type DevKind,
  type DevTrigger,
  type DevOwnerNode,
} from './devtools.js';

/** Which view the panel shows. */
type PanelView = 'nodes' | 'trace' | 'tree';

export interface DevtoolsPanelOptions {
  /** Where to dock the panel. Default `'bottom-right'`. */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  /** Container to mount into. Default `document.body`. */
  target?: HTMLElement;
}

const KIND_COLOR: Record<DevKind, string> = {
  signal: '#7ee787',
  computed: '#79c0ff',
  effect: '#d2a8ff',
};

/** Render a value compactly (strings quoted, objects JSON'd, errors labelled, all truncated). */
function formatValue(v: unknown): string {
  let s: string;
  if (v instanceof Error) s = `⚠ ${v.name}: ${v.message}`;
  else if (typeof v === 'string') s = JSON.stringify(v);
  else if (typeof v === 'function') s = 'ƒ';
  else if (typeof v === 'object' && v !== null) {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  } else s = String(v);
  return s.length > 120 ? s.slice(0, 117) + '…' : s;
}

const CORNER: Record<NonNullable<DevtoolsPanelOptions['position']>, string> = {
  'bottom-right': 'bottom:12px;right:12px',
  'bottom-left': 'bottom:12px;left:12px',
  'top-right': 'top:12px;right:12px',
  'top-left': 'top:12px;left:12px',
};

function emptyRow(text: string): HTMLDivElement {
  const empty: HTMLDivElement = document.createElement('div');
  empty.style.cssText = 'padding:10px;color:#8b949e';
  empty.textContent = text;
  return empty;
}

/** The flat "Nodes" view: every named node with its live value + `← deps`. */
function renderNodesView(
  list: HTMLDivElement,
  graph: { nodes: DevSnapshot[]; edges: { from: number; to: number }[] },
  q: string
): void {
  const nameById: Map<number, string> = new Map<number, string>(graph.nodes.map((n) => [n.id, n.name]));
  const depsById: Map<number, string[]> = new Map<number, string[]>();
  for (const e of graph.edges) {
    const name: string | undefined = nameById.get(e.from);
    if (!name) continue;
    const arr: string[] = depsById.get(e.to) ?? [];
    arr.push(name);
    depsById.set(e.to, arr);
  }
  const rows: DevSnapshot[] = graph.nodes.filter((n) => !q || n.name.toLowerCase().includes(q));
  if (rows.length === 0) {
    list.appendChild(emptyRow(isDevtoolsEnabled() ? 'No matching named nodes.' : 'enableDevtools() is off.'));
    return;
  }
  for (const n of rows) {
    const row: HTMLDivElement = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:baseline;padding:2px 10px;white-space:nowrap';
    const kind: HTMLSpanElement = document.createElement('span');
    kind.textContent = n.kind[0].toUpperCase();
    kind.title = n.kind;
    kind.style.cssText = `flex:none;width:14px;text-align:center;font-weight:700;color:${KIND_COLOR[n.kind]}`;
    const name: HTMLSpanElement = document.createElement('span');
    name.textContent = n.name;
    name.style.cssText = 'flex:none;color:#e6edf3';
    const val: HTMLSpanElement = document.createElement('span');
    val.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;color:#8b949e';
    if ('value' in n) val.textContent = '= ' + formatValue(n.value);
    row.append(kind, name, val);
    const deps: string[] | undefined = depsById.get(n.id);
    if (deps && deps.length > 0) {
      const dep: HTMLSpanElement = document.createElement('span');
      dep.textContent = '← ' + deps.join(', ');
      dep.title = 'reads (triggered by)';
      dep.style.cssText = 'flex:none;color:#6e7681;font-style:italic';
      row.appendChild(dep);
    }
    list.appendChild(row);
  }
}

/** The temporal "Trace" view: recent propagation events, newest first. */
function renderTraceView(list: HTMLDivElement, events: DevTrigger[], q: string): void {
  const rows: DevTrigger[] = events.filter(
    (e) => !q || e.fromName.toLowerCase().includes(q) || e.toName.toLowerCase().includes(q)
  );
  if (rows.length === 0) {
    list.appendChild(emptyRow(isDevtoolsEnabled() ? 'No triggers yet — change a signal.' : 'enableDevtools() is off.'));
    return;
  }
  for (const e of rows) {
    const row: HTMLDivElement = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:baseline;padding:2px 10px;white-space:nowrap';
    const seq: HTMLSpanElement = document.createElement('span');
    seq.textContent = '#' + e.seq;
    seq.style.cssText = 'flex:none;color:#6e7681';
    const edge: HTMLSpanElement = document.createElement('span');
    edge.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis';
    edge.textContent = `${e.fromName} → ${e.toName}`;
    row.append(seq, edge);
    list.appendChild(row);
  }
}

/** The "Tree" view: nodes nested under the component/owner scope hierarchy. */
function renderTreeView(list: HTMLDivElement, roots: DevOwnerNode[], q: string): void {
  let painted: number = 0;
  const paintScope = (scope: DevOwnerNode, depth: number): void => {
    const nodes: DevSnapshot[] = scope.nodes.filter((n) => !q || n.name.toLowerCase().includes(q));
    const kids: DevOwnerNode[] = scope.children;
    // Prune: when filtering, hide a scope with no matching node and no matching descendant.
    const before: number = painted;
    const scopeMatches: boolean = !q || (scope.name?.toLowerCase().includes(q) ?? false);
    const header: HTMLDivElement = document.createElement('div');
    header.style.cssText = `padding:2px 10px;padding-left:${10 + depth * 12}px;color:#79c0ff;font-weight:600;white-space:nowrap`;
    header.textContent = scope.name ? `▾ ${scope.name}` : '▾ ·scope';
    list.appendChild(header);
    for (const n of nodes) {
      const row: HTMLDivElement = document.createElement('div');
      row.style.cssText = `display:flex;gap:6px;align-items:baseline;padding:2px 10px;padding-left:${22 + depth * 12}px;white-space:nowrap`;
      const kind: HTMLSpanElement = document.createElement('span');
      kind.textContent = n.kind[0].toUpperCase();
      kind.style.cssText = `flex:none;width:14px;text-align:center;font-weight:700;color:${KIND_COLOR[n.kind]}`;
      const name: HTMLSpanElement = document.createElement('span');
      name.textContent = n.name;
      name.style.cssText = 'flex:none;color:#e6edf3';
      const val: HTMLSpanElement = document.createElement('span');
      val.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;color:#8b949e';
      if ('value' in n) val.textContent = '= ' + formatValue(n.value);
      row.append(kind, name, val);
      list.appendChild(row);
      painted++;
    }
    for (const child of kids) paintScope(child, depth + 1);
    // Retroactively drop an all-empty scope header when filtering yielded nothing under it.
    if (q && !scopeMatches && painted === before) header.remove();
  };
  for (const r of roots) paintScope(r, 0);
  if (painted === 0 && list.childElementCount === 0) {
    list.appendChild(emptyRow(isDevtoolsEnabled() ? 'No named nodes yet.' : 'enableDevtools() is off.'));
  }
}

/**
 * Mount the floating DevTools panel. Returns a disposer that removes the panel, stops its
 * reactive effect, and unsubscribes from the registry. Safe to call when devtools are off —
 * the panel simply shows an empty list until nodes are registered.
 */
export function mountDevtoolsPanel(options: DevtoolsPanelOptions = {}): () => void {
  const target: HTMLElement = options.target ?? document.body;
  const filter: Signal<string> = signal<string>('');
  const view: Signal<PanelView> = signal<PanelView>('nodes');
  // Bridge registry-membership changes into reactivity (value changes are tracked by
  // reading each node's getter inside the render effect below).
  const version: Signal<number> = signal<number>(0);
  const offChange: () => void = onDevtoolsChange(() => version.set(version.peek() + 1));

  const root: HTMLDivElement = document.createElement('div');
  root.className = 'weave-devtools';
  root.setAttribute('data-weave-devtools', '');
  root.style.cssText =
    `position:fixed;${CORNER[options.position ?? 'bottom-right']};z-index:2147483647;` +
    'width:320px;max-height:60vh;display:flex;flex-direction:column;' +
    'font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e6edf3;' +
    'background:#0d1117ee;border:1px solid #30363d;border-radius:8px;overflow:hidden;' +
    'box-shadow:0 8px 24px #0008;backdrop-filter:blur(4px)';

  const header: HTMLDivElement = document.createElement('div');
  header.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid #30363d';
  const title: HTMLSpanElement = document.createElement('span');
  title.style.cssText = 'font-weight:600;white-space:nowrap';
  const search: HTMLInputElement = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'filter…';
  search.setAttribute('aria-label', 'Filter reactive nodes by name');
  search.style.cssText =
    'flex:1;min-width:0;background:#010409;color:inherit;border:1px solid #30363d;' +
    'border-radius:5px;padding:3px 6px;font:inherit';
  search.addEventListener('input', () => filter.set(search.value));
  header.append(title, search);

  // Tab bar — Nodes / Trace / Tree.
  const tabs: HTMLDivElement = document.createElement('div');
  tabs.style.cssText = 'display:flex;gap:4px;padding:6px 10px;border-bottom:1px solid #30363d';
  const TAB_LABELS: Record<PanelView, string> = { nodes: 'Nodes', trace: 'Trace', tree: 'Tree' };
  const tabButtons: Record<PanelView, HTMLButtonElement> = {} as Record<PanelView, HTMLButtonElement>;
  (Object.keys(TAB_LABELS) as PanelView[]).forEach((v) => {
    const b: HTMLButtonElement = document.createElement('button');
    b.type = 'button';
    b.textContent = TAB_LABELS[v];
    b.setAttribute('data-weave-devtools-tab', v);
    b.style.cssText =
      'flex:1;background:#010409;color:#8b949e;border:1px solid #30363d;border-radius:5px;' +
      'padding:2px 0;font:inherit;cursor:pointer';
    b.addEventListener('click', () => view.set(v));
    tabButtons[v] = b;
    tabs.appendChild(b);
  });

  const list: HTMLDivElement = document.createElement('div');
  list.style.cssText = 'overflow:auto;padding:4px 0';
  list.setAttribute('data-weave-devtools-list', '');

  root.append(header, tabs, list);
  target.appendChild(root);

  // Single render effect: reads `version()` (registry changes), `inspect()` (each node's
  // getter → tracks value changes — also the moment new trace events arrive), `filter()`
  // and `view()`, so it re-runs on any of them — no polling.
  const stop: () => void = effect(() => {
    version();
    const q: string = filter().toLowerCase();
    const v: PanelView = view();
    // Read every live value so the effect subscribes to value changes for ALL tabs (the
    // Trace tab has no getter reads of its own, so this is what keeps it live).
    const snapshot: DevSnapshot[] = inspect();
    const total: number = isDevtoolsEnabled() ? snapshot.length : 0;

    // Reflect the active tab.
    (Object.keys(tabButtons) as PanelView[]).forEach((k) => {
      const active: boolean = k === v;
      tabButtons[k].style.color = active ? '#e6edf3' : '#8b949e';
      tabButtons[k].style.borderColor = active ? '#58a6ff' : '#30363d';
      tabButtons[k].setAttribute('aria-pressed', String(active));
    });

    list.textContent = '';
    if (v === 'trace') {
      title.textContent = `Weave DevTools · trace`;
      renderTraceView(list, inspectTrace(100), q);
    } else if (v === 'tree') {
      title.textContent = `Weave DevTools · tree`;
      renderTreeView(list, inspectTree(), q);
    } else {
      const graph: { nodes: DevSnapshot[]; edges: { from: number; to: number }[] } = inspectGraph();
      const shown: number = graph.nodes.filter((n) => !q || n.name.toLowerCase().includes(q)).length;
      title.textContent = `Weave DevTools · ${shown}/${total}`;
      renderNodesView(list, graph, q);
    }
  });

  return (): void => {
    stop();
    offChange();
    root.remove();
  };
}
