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

interface ApiPageSetup {
  title: () => string;
  symbols: () => ApiSymbol[];
  count: () => number;
  notFound: () => boolean;
  introHost: Signal<Element | null>;
  examplesFor: (name: string) => ApiExample[];
}

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

  return { title, symbols, count, notFound, introHost, examplesFor };
}
