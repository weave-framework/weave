import { onMount, effect, signal, type Signal } from '@weave-framework/runtime';
import { parse } from '../markdown/parse';
import { renderDoc } from '../markdown/render';
import { scrollToHash } from '../util/scroll';

interface DocPageProps {
  /** The page's markdown source. */
  source?: string;
}

interface DocPageSetup {
  host: Signal<Element | null>;
}

/** Renders a markdown page: parses the source to an AST, then mounts the rendered
 *  DOM (including any live demos) into the host element once it exists. */
export function setup(props: DocPageProps): DocPageSetup {
  const host = signal<Element | null>(null);

  // Build the content during render (an effect runs synchronously as the `ref` sets `host`), so it is
  // present in the server-rendered HTML too — not deferred to a browser-only lifecycle. Append once.
  effect(() => {
    const el = host();
    if (!el || el.childNodes.length) return;
    el.append(renderDoc(parse(props.source ?? '')));
  });

  // Deep-link anchor scroll is browser-only — onMount never fires during SSR, so `location` is safe here.
  onMount(() => {
    if (location.hash) scrollToHash(location.hash);
  });

  return { host };
}
