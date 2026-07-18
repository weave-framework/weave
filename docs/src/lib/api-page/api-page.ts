import { signal, effect, type Signal } from '@weave-framework/runtime';
import CodeBlock from '../code-block/code-block';
import { api, apiTitles, type ApiSymbol } from '../../content/api.gen';
import { intros, examples, type ApiExample } from '../../content/reference/overlay';
import { parse } from '../markdown/parse';
import { renderDoc } from '../markdown/render';

void CodeBlock;

interface ApiPageProps {
  /** Package key, e.g. 'runtime' (the `:pkg` route param). */
  pkg?: string;
}

/** One kind's worth of exports, for the jump index at the top of the page. */
interface ApiGroup {
  kind: string;
  label: string;
  items: ApiSymbol[];
}

interface ApiPageSetup {
  title: () => string;
  symbols: () => ApiSymbol[];
  groups: () => ApiGroup[];
  count: () => number;
  notFound: () => boolean;
  introHost: Signal<Element | null>;
  examplesFor: (name: string) => ApiExample[];
  hrefFor: (anchor: string) => string;
}

/** Index grouping + display order. `runtime` alone exports 56 symbols, so the page opens
 *  with a jump index rather than 56 expanded sections you have to scroll past. */
const KIND_ORDER: { kind: string; label: string }[] = [
  { kind: 'function', label: 'Functions' },
  { kind: 'class', label: 'Classes' },
  { kind: 'interface', label: 'Interfaces' },
  { kind: 'type', label: 'Types' },
  { kind: 'const', label: 'Constants' },
  { kind: 'enum', label: 'Enums' },
];

/** Renders a package's API reference: the generated skeleton (signatures + TSDoc +
 *  params, from api.gen) merged with a hand-authored overlay (a package intro and
 *  per-symbol examples, from content/reference/overlay). The `pkg` prop drives it,
 *  so one dynamic route serves every package and a param change updates in place. */
export function setup(props: ApiPageProps): ApiPageSetup {
  const key = (): string => props.pkg ?? '';
  const symbols = (): ApiSymbol[] => api[key()] ?? [];
  const title = (): string => apiTitles[key()] ?? key();
  const count = (): number => symbols().length;
  const notFound = (): boolean => !(key() in api);

  // The package intro is hand-authored markdown; render it reactively so it follows
  // a param-only route change (the component instance is reused, not remounted).
  const introHost = signal<Element | null>(null);
  effect(() => {
    const el = introHost();
    if (!el) return;
    const md = intros[key()] ?? '';
    el.replaceChildren(md ? renderDoc(parse(md)) : document.createDocumentFragment());
  });

  const examplesFor = (name: string): ApiExample[] => examples[`${key()}/${name}`] ?? [];

  // Bucket the exports by kind for the index. A kind the generator emits that KIND_ORDER
  // doesn't list still gets its own group rather than being silently dropped — a missing
  // export is exactly the failure an index is supposed to make visible.
  const groups = (): ApiGroup[] => {
    const all = symbols();
    const byName = (a: ApiSymbol, b: ApiSymbol): number => a.name.localeCompare(b.name);
    const known = new Set(KIND_ORDER.map((k) => k.kind));
    const out: ApiGroup[] = [];
    for (const { kind, label } of KIND_ORDER) {
      const items = all.filter((s) => s.kind === kind).sort(byName);
      if (items.length) out.push({ kind, label, items });
    }
    for (const kind of new Set(all.filter((s) => !known.has(s.kind)).map((s) => s.kind))) {
      out.push({ kind, label: kind, items: all.filter((s) => s.kind === kind).sort(byName) });
    }
    return out;
  };

  // The index links must carry the FULL route, not a bare `#anchor`. The docs shell ships
  // `<base href="/">`, so a relative fragment resolves against the base — `#batch` becomes
  // `/#batch`, a different document — and clicking one left the page entirely for the home
  // route with a full reload. Spelling out `/reference/<pkg>#<anchor>` keeps it same-document
  // (so the browser just scrolls) and keeps the link copyable / middle-clickable.
  const hrefFor = (anchor: string): string => `/reference/${key()}#${anchor}`;

  return { title, symbols, groups, count, notFound, introHost, examplesFor, hrefFor };
}
