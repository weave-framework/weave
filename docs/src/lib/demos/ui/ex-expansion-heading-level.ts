import Expansion from '@weave-framework/ui/expansion';

// Capitalized tags in the template resolve to this import.
void Expansion;

interface Setup {
  panels: { id: string; header: string; body: string }[];
}

/** headingLevel sets the aria-level of each header's heading wrapper (here 2, under a page h1). */
export function setup(): Setup {
  const panels = [
    { id: 'q1', header: 'What is Weave?', body: 'A signal-native front-end framework.' },
    { id: 'q2', header: 'Is it zero-dependency?', body: 'Yes — everything is built in-house.' },
  ];
  return { panels };
}
