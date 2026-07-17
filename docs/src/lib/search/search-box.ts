import { signal, computed, type Signal, type Computed } from '@weave-framework/runtime';
import { navigate } from '@weave-framework/router';
import Input from '@weave-framework/ui/input';
import Icon from '@weave-framework/ui/icon';
import { search, type Result } from './search';
import { scrollToHash } from '../util/scroll';
import type { SearchEntry } from './build-index';

// Capitalized tags in the template resolve to these imports.
void Input;
void Icon;

interface SearchBoxSetup {
  query: Signal<string>;
  results: Computed<Result[]>;
  setQuery: (value: string) => void;
  wireField: (el: HTMLInputElement | HTMLTextAreaElement) => void;
  go: (r: Result) => void;
  isActive: (i: number) => boolean;
  hasResults: () => boolean;
  empty: () => boolean;
}

/** The docs search: a fuzzy, synonym-aware search box with a results dropdown and full
 *  keyboard navigation. The field is the real Weave-UI `<Input>` (composed, with a search
 *  icon prefix); its focus/blur/keyboard behaviour is wired onto the native field via
 *  `onInputRef` — the same composition hook Autocomplete uses — while the results panel
 *  stays bespoke (related/indirect hits are flagged, so it's "what might be relevant"). */
export function setup(): SearchBoxSetup {
  const query = signal('');
  const open = signal(false);
  const active = signal(0);

  // The index is the WHOLE docs corpus — every page's markdown, parsed. A static import put it in every
  // page's download (~217 KB gz) and ran the parse at module init, on pages the reader never searches. The
  // search box lives in the shell, so that was every page. Loaded on first use instead: the chunk and the
  // parse both wait until someone actually opens search.
  const index = signal<SearchEntry[] | null>(null);
  const loadIndex = (): void => {
    if (index()) return;
    void import('./build-index').then((m) => index.set(m.entries));
  };

  const results = computed<Result[]>(() => {
    const idx: SearchEntry[] | null = index();
    return idx && query().trim() ? search(idx, query()) : [];
  });

  // Input's value binding calls this on every keystroke.
  const setQuery = (value: string): void => {
    loadIndex();
    query.set(value);
    open.set(true);
    active.set(0);
  };

  const onFocus = (): void => {
    loadIndex(); // warm it while they are typing the first character
    if (query().trim()) open.set(true);
  };
  // Delay close so a click on a result registers before the panel hides.
  const onBlur = (): void => {
    setTimeout(() => open.set(false), 140);
  };

  const go = (r: Result): void => {
    navigate(r.entry.path);
    query.set('');
    open.set(false);
    const hash = r.entry.path.split('#')[1];
    if (hash) scrollToHash(hash); // anchor target may render a tick later
  };

  const onKey = (e: KeyboardEvent): void => {
    const list = results();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active.set((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active.set((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = list[active()];
      if (r) go(r);
    } else if (e.key === 'Escape') {
      open.set(false);
    }
  };

  // Attach the panel's focus/blur/keyboard behaviour onto the composed Input's native
  // field (Input owns the element; we only add listeners — no re-created field).
  const wireField = (el: HTMLInputElement | HTMLTextAreaElement): void => {
    el.addEventListener('focus', onFocus);
    el.addEventListener('blur', onBlur);
    el.addEventListener('keydown', onKey);
  };

  const isActive = (i: number): boolean => active() === i;
  const hasResults = (): boolean => open() && query().trim().length > 0;
  const empty = (): boolean => hasResults() && results().length === 0;

  return { query, results, setQuery, wireField, go, isActive, hasResults, empty };
}
