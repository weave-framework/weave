import { onMount, signal, type Signal } from '@weave/runtime';
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

  onMount(() => {
    const el = host();
    if (!el) return;
    el.append(renderDoc(parse(props.source ?? '')));
    // Honor a deep-link anchor once the content (and its heading ids) exist.
    if (location.hash) scrollToHash(location.hash);
  });

  return { host };
}
