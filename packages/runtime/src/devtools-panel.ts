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
import { inspect, onDevtoolsChange, isDevtoolsEnabled, type DevSnapshot, type DevKind } from './devtools.js';

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

/**
 * Mount the floating DevTools panel. Returns a disposer that removes the panel, stops its
 * reactive effect, and unsubscribes from the registry. Safe to call when devtools are off —
 * the panel simply shows an empty list until nodes are registered.
 */
export function mountDevtoolsPanel(options: DevtoolsPanelOptions = {}): () => void {
  const target: HTMLElement = options.target ?? document.body;
  const filter: Signal<string> = signal<string>('');
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

  const list: HTMLDivElement = document.createElement('div');
  list.style.cssText = 'overflow:auto;padding:4px 0';
  list.setAttribute('data-weave-devtools-list', '');

  root.append(header, list);
  target.appendChild(root);

  // Single render effect: reads `version()` (registry changes) + `inspect()` (each node's
  // getter → tracks value changes) + `filter()`, so it re-runs on any of them — no polling.
  const stop: () => void = effect(() => {
    version();
    const q: string = filter().toLowerCase();
    const rows: DevSnapshot[] = inspect().filter((n) => !q || n.name.toLowerCase().includes(q));
    const total: number = isDevtoolsEnabled() ? inspect().length : 0;
    title.textContent = `Weave DevTools · ${rows.length}/${total}`;

    list.textContent = '';
    if (rows.length === 0) {
      const empty: HTMLDivElement = document.createElement('div');
      empty.style.cssText = 'padding:10px;color:#8b949e';
      empty.textContent = isDevtoolsEnabled() ? 'No matching named nodes.' : 'enableDevtools() is off.';
      list.appendChild(empty);
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
      if ('value' in n) {
        val.textContent = '= ' + formatValue(n.value);
      }
      row.append(kind, name, val);
      list.appendChild(row);
    }
  });

  return (): void => {
    stop();
    offChange();
    root.remove();
  };
}
