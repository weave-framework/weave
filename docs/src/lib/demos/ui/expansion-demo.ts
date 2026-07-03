import { signal } from '@weave-framework/runtime';
import Expansion from '@weave-framework/ui/expansion';

// Capitalized tags in the template resolve to this import.
void Expansion;

interface Setup {
  panels: { id: string; header: string; body: string }[];
  open: () => string[];
  setOpen: (v: string[]) => void;
}

/** An accordion bound to the set of open panel ids. */
export function setup(): Setup {
  const open = signal<string[]>(['shipping']);
  const panels = [
    { id: 'shipping', header: 'Shipping', body: 'Free over €50. Arrives in 2–4 business days.' },
    { id: 'returns', header: 'Returns', body: '30-day returns, no questions asked.' },
    { id: 'warranty', header: 'Warranty', body: 'Two-year limited warranty on every order.' },
  ];
  return { panels, open, setOpen: (v) => open.set(v) };
}
