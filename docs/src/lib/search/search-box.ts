import { signal, computed, type Signal, type Computed } from '@weave-framework/runtime';
import { navigate } from '@weave-framework/router';
import { entries } from './build-index';
import { search, type Result } from './search';
import { scrollToHash } from '../util/scroll';

interface SearchBoxSetup {
  query: Signal<string>;
  results: Computed<Result[]>;
  onInput: () => void;
  onFocus: () => void;
  onBlur: () => void;
  onKey: (e: KeyboardEvent) => void;
  go: (r: Result) => void;
  isActive: (i: number) => boolean;
  hasResults: () => boolean;
  empty: () => boolean;
}

/** The docs search: a fuzzy, synonym-aware search box with a results dropdown and
 *  full keyboard navigation. Related/indirect hits are flagged so the user sees
 *  "what might be relevant", not just exact-word matches. */
export function setup(): SearchBoxSetup {
  const query = signal('');
  const open = signal(false);
  const active = signal(0);

  const results = computed<Result[]>(() => (query().trim() ? search(entries, query()) : []));

  const onInput = (): void => {
    open.set(true);
    active.set(0);
  };
  const onFocus = (): void => {
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

  const isActive = (i: number): boolean => active() === i;
  const hasResults = (): boolean => open() && query().trim().length > 0;
  const empty = (): boolean => hasResults() && results().length === 0;

  return { query, results, onInput, onFocus, onBlur, onKey, go, isActive, hasResults, empty };
}
