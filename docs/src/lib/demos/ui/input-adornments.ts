import { signal } from '@weave-framework/runtime';
import Input from '@weave-framework/ui/input';
import Icon from '@weave-framework/ui/icon';

// Capitalized tags in the template resolve to these imports.
void Input;
void Icon;

interface Setup {
  amount: () => string;
  setAmount: (v: string) => void;
  q: () => string;
  setQ: (v: string) => void;
}

/** Prefix / suffix slots — an icon or text flanking the field inside the underline. */
export function setup(): Setup {
  const amount = signal('');
  const q = signal('');
  return { amount, setAmount: (v) => amount.set(v), q, setQ: (v) => q.set(v) };
}
