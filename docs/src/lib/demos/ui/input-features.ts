import { signal } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';
import Icon from '@weave-framework/ui/icon';

// Capitalized tags in the template resolve to these imports.
void Input;
void Icon;

interface Setup {
  search: () => string;
  setSearch: (v: string) => void;
}

/** A clearable field with a prefix icon in the slot. */
export function setup(): Setup {
  const search = signal('weave');
  return { search, setSearch: (v) => search.set(v) };
}
