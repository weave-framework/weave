import Expansion from '@weave-framework/ui/expansion';

// Capitalized tags in the template resolve to this import.
void Expansion;

interface Setup {
  panels: { id: string; header: string; body: string }[];
}

/** class is forwarded onto the container — hook your own styles onto it. */
export function setup(): Setup {
  const panels = [
    { id: 'one', header: 'Section one', body: 'The container carries both weave-expansion and my-accordion.' },
    { id: 'two', header: 'Section two', body: 'Style .my-accordion in your own stylesheet.' },
  ];
  return { panels };
}
