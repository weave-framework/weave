import Expansion from '@weave-framework/ui/expansion';

// Capitalized tags in the template resolve to this import.
void Expansion;

interface Setup {
  panels: { id: string; header: string; body: string }[];
}

/** Uncontrolled — no value/onChange; defaultOpen seeds the initial open set. */
export function setup(): Setup {
  const panels = [
    { id: 'intro', header: 'Introduction', body: 'This panel starts open, seeded by defaultOpen.' },
    { id: 'setup', header: 'Setup', body: 'Install the package and import the component.' },
    { id: 'usage', header: 'Usage', body: 'Describe your panels as data and render.' },
  ];
  return { panels };
}
