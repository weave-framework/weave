import Expansion from '@weave-framework/ui/expansion';

// Capitalized tags in the template resolve to this import.
void Expansion;

interface Setup {
  panels: { id: string; header: string; body: string }[];
}

/** disabled on the whole accordion — every header is marked and blocked. */
export function setup(): Setup {
  const panels = [
    { id: 'a', header: 'Account', body: 'Editing is locked while your session is read-only.' },
    { id: 'b', header: 'Billing', body: 'Editing is locked while your session is read-only.' },
  ];
  return { panels };
}
